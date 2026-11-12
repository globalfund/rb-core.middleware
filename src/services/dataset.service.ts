import { inject } from "@loopback/core";
import { Filter, repository } from "@loopback/repository";
import axios from "axios";
import { DatasetModel } from "../models";
import {
  ChartRepository,
  ReportRepository,
  DatasetRepository,
} from "../repositories";
import { handleDeleteCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import {
  assertSafeId,
  badGateway,
  badRequest,
  omitServerManagedFields,
  unprocessable,
  unsupportedMediaType,
} from "../utils/access";

/** The data backend (rb-core-backend) that stores and serves the datasets. */
export type DatasetBackend = {
  baseUrl: string;
  /** Sent as the Authorization header. */
  apiKey?: string;
};

/**
 * A search result of an external source, as returned by the backend: one per
 * data file of a dataset. `name` and `url` identify the file to the backend.
 */
export type ExternalDataset = {
  name: string;
  url: string;
  source: string;
  title?: string;
  file?: string;
  summary?: string;
  category?: string;
  datePublished?: string;
};

export type ExternalSourceSearch = {
  source: string;
  q?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
};

/** The file types the backend can read, by their extension. */
export const DATASET_UPLOAD_FILE_EXTENSIONS = [
  ".csv",
  ".tsv",
  ".json",
  ".xlsx",
  ".xlsm",
  ".parquet",
];

// The separator the backend uses to combine a dataset title with one of its files.
const DATA_FILE_SEPARATOR = " - Data file: ";
// Downloading and processing a dataset can take minutes for large files.
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;

const backendHeaders = (backend: DatasetBackend) =>
  backend.apiKey ? { Authorization: backend.apiKey } : {};

/**
 * The backend answers with `{code, result}`, where result is a message on
 * failure. A failure it explains is the caller's to act on (422), anything
 * else means the backend could not be reached or broke (502).
 */
const backendError = (error: unknown, fallback: string) => {
  const result = (error as { response?: { data?: { result?: unknown } } })
    ?.response?.data?.result;
  return typeof result === "string" && result
    ? unprocessable(result)
    : badGateway(fallback);
};

const getExtension = (fileName: string) => {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index).toLowerCase() : "";
};

export class DatasetService {
  constructor(
    @repository(DatasetRepository)
    public datasetRepository: DatasetRepository,

    @repository(ChartRepository)
    public chartRepository: ChartRepository,

    @repository(ReportRepository)
    public reportRepository: ReportRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  /** Creates a private dataset owned by the user. */
  async create(
    userId: string,
    dataset: Omit<DatasetModel, "id">,
  ): Promise<DatasetModel> {
    this.logger.info(`DatasetService - create - Creating dataset`);
    await handleDeleteCache({ userId, asset: "dataset" });
    const created = await this.datasetRepository.create({
      ...omitServerManagedFields(dataset),
      owner: userId,
      public: false,
      baseline: false,
    });
    // The MongoDB connector returns the generated id as an ObjectId.
    created.id = String(created.id);
    return created;
  }

  async find(filter?: Filter<DatasetModel>): Promise<DatasetModel[]> {
    this.logger.info(`DatasetService - find - Fetching datasets`);
    return this.datasetRepository.find(filter);
  }

  /** The datasets the user uploaded or connected, newest first. */
  async findOwn(
    userId: string,
    filter?: Filter<DatasetModel>,
  ): Promise<DatasetModel[]> {
    this.logger.info(`DatasetService - findOwn - Fetching datasets of user`);
    return this.datasetRepository.find({
      order: ["createdDate DESC"],
      ...filter,
      where: { and: [filter?.where ?? {}, { owner: userId }] },
    });
  }

  /** The datasets everyone may see, for routes without a signed-in user. */
  async findPublic(filter?: Filter<DatasetModel>): Promise<DatasetModel[]> {
    this.logger.info(`DatasetService - findPublic - Fetching public datasets`);
    return this.datasetRepository.find({
      ...filter,
      where: { and: [filter?.where ?? {}, { public: true }] },
    });
  }

  /**
   * Creates the dataset, has `storeData` store its data in the backend under
   * the new id, and removes the dataset again when that fails.
   */
  private async createWithData(
    userId: string,
    dataset: Partial<DatasetModel> & Record<string, unknown>,
    storeData: (id: string) => Promise<unknown>,
    failureMessage: string,
  ): Promise<DatasetModel> {
    const created = await this.create(userId, {
      category: "General",
      ...dataset,
      // The model does not accept an empty description.
      description: dataset.description
        ? dataset.description
        : `${dataset.source} dataset`,
    } as Omit<DatasetModel, "id">);
    try {
      await storeData(assertSafeId(created.id, "datasetId"));
    } catch (error) {
      await this.datasetRepository.deleteById(created.id);
      this.logger.error(
        `DatasetService - createWithData - ${dataset.source} dataset ${created.id} failed: ${(error as Error)?.message}`,
      );
      throw backendError(error, failureMessage);
    }
    return created;
  }

  /** The number of datasets (data files) the backend indexed per external source. */
  async externalSourceCounts(
    backend: DatasetBackend,
  ): Promise<Record<string, number>> {
    return axios
      .get(`${backend.baseUrl}/external-sources/counts`, {
        headers: backendHeaders(backend),
      })
      .then((res) => res.data.result)
      .catch((error) => {
        throw backendError(error, "Unable to reach the external sources.");
      });
  }

  /** Searches the datasets the backend indexed for an external source. */
  async searchExternalSources(
    params: ExternalSourceSearch,
    backend: DatasetBackend,
  ): Promise<ExternalDataset[]> {
    this.logger.info(
      `DatasetService - searchExternalSources - Searching ${params.source}`,
    );
    return axios
      .get(`${backend.baseUrl}/external-sources/search`, {
        headers: backendHeaders(backend),
        params: {
          source: params.source,
          q: params.q ?? "",
          limit: params.limit ?? 20,
          offset: params.offset ?? 0,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          sort_by: params.sortBy,
        },
      })
      .then((res) => res.data.result)
      .catch((error) => {
        throw backendError(error, "Unable to search the external sources.");
      });
  }

  /**
   * Has the backend download a search result of an external source, and
   * creates the dataset for it. Returns the existing dataset when the user
   * connected the same file before.
   */
  async connectExternalDataset(
    userId: string,
    externalDataset: ExternalDataset,
    backend: DatasetBackend,
  ): Promise<DatasetModel> {
    const { name, url, source } = externalDataset ?? {};
    if (
      typeof source !== "string" ||
      !source ||
      typeof url !== "string" ||
      typeof name !== "string" ||
      !name.includes(DATA_FILE_SEPARATOR)
    ) {
      throw badRequest("Invalid external dataset");
    }
    const existing = await this.datasetRepository.findOne({
      where: { owner: userId, sourceUrl: url, externalName: name } as object,
    });
    if (existing) {
      existing.id = String(existing.id);
      return existing;
    }

    const [title, file] = name.split(DATA_FILE_SEPARATOR);
    const { summary, category } = externalDataset;
    this.logger.info(
      `DatasetService - connectExternalDataset - Connecting ${source} dataset ${url}`,
    );
    return this.createWithData(
      userId,
      {
        name: (file && file !== title ? `${title} - ${file}` : title).slice(
          0,
          MAX_NAME_LENGTH,
        ),
        description:
          typeof summary === "string"
            ? summary.slice(0, MAX_DESCRIPTION_LENGTH)
            : "",
        category:
          typeof category === "string" && category
            ? category.slice(0, MAX_NAME_LENGTH)
            : "General",
        source,
        sourceUrl: url,
        externalName: name,
      },
      (id) =>
        axios.post(
          `${backend.baseUrl}/external-sources/download`,
          { name, url, source, id },
          { headers: backendHeaders(backend), timeout: PROCESSING_TIMEOUT_MS },
        ),
      "Unable to connect the selected dataset.",
    );
  }

  /**
   * Has the backend process an uploaded file, and creates the dataset for it,
   * named after the file unless a name is provided.
   */
  async uploadDataset(
    userId: string,
    file: { fileName: string; content: Buffer; name?: string },
    backend: DatasetBackend,
  ): Promise<DatasetModel> {
    if (!file?.content?.length) {
      throw badRequest("The file is empty.");
    }
    // Only the last part of a path a client may have sent as file name.
    const fileName = file.fileName.split(/[\\/]/).pop() ?? "";
    const extension = getExtension(fileName);
    if (!DATASET_UPLOAD_FILE_EXTENSIONS.includes(extension)) {
      throw unsupportedMediaType(
        `Unsupported file type, please upload one of: ${DATASET_UPLOAD_FILE_EXTENSIONS.join(", ")}`,
      );
    }
    const providedName = file.name?.trim();
    const baseName = fileName.slice(0, fileName.length - extension.length);
    const name = providedName ? providedName : baseName;

    this.logger.info(
      `DatasetService - uploadDataset - Uploading ${extension} file of ${file.content.length} bytes`,
    );
    return this.createWithData(
      userId,
      {
        name: name.slice(0, MAX_NAME_LENGTH),
        description: `Uploaded from ${fileName}`.slice(
          0,
          MAX_DESCRIPTION_LENGTH,
        ),
        source: "Upload",
        fileName,
      },
      (id) =>
        axios.post(`${backend.baseUrl}/upload-file/${id}`, file.content, {
          headers: {
            ...backendHeaders(backend),
            "Content-Type": "application/octet-stream",
          },
          // The backend only needs the extension, to pick a reader.
          params: { filename: `upload${extension}` },
          timeout: PROCESSING_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      "Unable to process the uploaded file.",
    );
  }

  async datasetContent(
    id: string,
    page: string,
    pageSize: string,
    backendApiBaseUrl: string,
  ): Promise<any> {
    this.logger.info(
      `DatasetService - datasetContent - get dataset content by id: ${id}`,
    );
    return axios
      .get(
        `${backendApiBaseUrl}/dataset/${id}?page=${page}&page_size=${pageSize}`,
      )
      .then((res) => {
        this.logger.info(
          `DatasetService - datasetContent - Data fetched for dataset ${id}`,
        );
        return res.data;
      })
      .catch((error) => {
        console.log(error);
        this.logger.error(
          `DatasetService - datasetContent - Error fetching data for dataset ${id}; ${error}`,
        );
        return { data: [], error };
      });
  }

  async getChartAndReportCount(
    id: string,
  ): Promise<{ chartCount: number; reportCount: number } | { error: string }> {
    this.logger.info(
      `DatasetService - getChartAndReportCount - get chart & report count by dataset id: ${id}`,
    );

    const chartIds = (
      await this.chartRepository.find({ where: { datasetId: id } })
    ).map((c) => c.id);
    return {
      chartCount: (await this.chartRepository.count({ datasetId: id })).count,
      reportCount: (await this.reportRepository.execute?.(
        "ReportModel",
        "countDocuments",
        { "rows.items": { $in: chartIds } },
      )) as unknown as number,
    };
  }
}
