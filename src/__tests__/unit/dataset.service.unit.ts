import { expect, sinon } from "@loopback/testlab";
import axios from "axios";
import { DatasetModel } from "../../models";
import { expectStatus, givenServices, OTHER, OWNER } from "./fixtures";

const BACKEND = { baseUrl: "http://backend", apiKey: "secret" };
const WHO_DATASET = {
  name: "Life expectancy - Data file: Life expectancy",
  url: "https://ghoapi.azureedge.net/api/WHOSIS_000001",
  source: "WHO",
  summary: "WHO Global Health Observatory indicator WHOSIS_000001.",
  category: "Health",
};
const backendFailure = (status: number, result?: string) => ({
  message: "failed",
  response: { status, data: { result } },
});

describe("DatasetService (unit)", () => {
  let ctx: ReturnType<typeof givenServices>;
  let post: sinon.SinonStub;
  let get: sinon.SinonStub;

  beforeEach(() => {
    sinon.stub(console, "log");
    ctx = givenServices();
    post = sinon.stub(axios, "post").resolves({ data: { result: "Success" } });
    get = sinon.stub(axios, "get").resolves({ data: { result: [] } });
  });

  afterEach(() => sinon.restore());

  const givenDataset = (data: Partial<DatasetModel> = {}) =>
    ctx.datasetRepository.create({
      name: "Dataset",
      description: "A dataset",
      category: "General",
      source: "Upload",
      public: false,
      owner: OWNER,
      ...data,
    });

  describe("create", () => {
    it("creates a private dataset with a string id, whatever the caller sends", async () => {
      const dataset = await ctx.datasetService.create(OWNER, {
        name: "New",
        description: "A dataset",
        category: "General",
        source: "Upload",
        owner: OTHER,
        public: true,
        baseline: true,
      } as DatasetModel);

      expect(dataset.id).to.be.a.String();
      expect(await ctx.datasetRepository.findById(dataset.id)).to.containDeep({
        owner: OWNER,
        public: false,
        baseline: false,
      });
    });
  });

  describe("findOwn and findPublic", () => {
    it("only return the datasets of the user, or the public ones", async () => {
      await givenDataset({ name: "Mine" });
      await givenDataset({ name: "Theirs", owner: OTHER });
      await givenDataset({ name: "Shared", owner: OTHER, public: true });

      const own = await ctx.datasetService.findOwn(OWNER);
      expect(own.map((d) => d.name)).to.eql(["Mine"]);
      // A caller-supplied filter cannot widen the result.
      const widened = await ctx.datasetService.findOwn(OWNER, {
        where: { owner: OTHER },
      });
      expect(widened).to.be.empty();

      const open = await ctx.datasetService.findPublic({
        where: { public: false },
      });
      expect(open).to.be.empty();
      const shared = await ctx.datasetService.findPublic();
      expect(shared.map((d) => d.name)).to.eql(["Shared"]);
    });
  });

  describe("external sources", () => {
    it("searches and counts through the backend", async () => {
      get.resolves({ data: { result: [WHO_DATASET] } });
      const found = await ctx.datasetService.searchExternalSources(
        { source: "WHO", q: "life", offset: 20 },
        BACKEND,
      );

      expect(found).to.eql([WHO_DATASET]);
      const [url, config] = get.firstCall.args;
      expect(url).to.equal("http://backend/external-sources/search");
      expect(config.headers).to.eql({ Authorization: "secret" });
      expect(config.params).to.containEql({
        source: "WHO",
        q: "life",
        limit: 20,
        offset: 20,
      });

      get.resolves({ data: { result: { WHO: 3, Kaggle: 5 } } });
      expect(await ctx.datasetService.externalSourceCounts(BACKEND)).to.eql({
        WHO: 3,
        Kaggle: 5,
      });
    });

    it("reports why the backend could not search, or that it is unreachable", async () => {
      get.rejects(backendFailure(500, "Not indexed yet."));
      await expect(
        ctx.datasetService.searchExternalSources({ source: "WHO" }, BACKEND),
      ).to.be.rejectedWith({ statusCode: 422, message: "Not indexed yet." });

      get.rejects(new Error("ECONNREFUSED"));
      await expectStatus(ctx.datasetService.externalSourceCounts(BACKEND), 502);
    });
  });

  describe("connectExternalDataset", () => {
    it("creates the dataset and has the backend download it under its id", async () => {
      const dataset = await ctx.datasetService.connectExternalDataset(
        OWNER,
        WHO_DATASET,
        BACKEND,
      );

      expect(dataset).to.containDeep({
        name: "Life expectancy",
        description: WHO_DATASET.summary,
        category: "Health",
        source: "WHO",
        sourceUrl: WHO_DATASET.url,
        owner: OWNER,
        public: false,
      });
      const [url, body] = post.firstCall.args;
      expect(url).to.equal("http://backend/external-sources/download");
      expect(body).to.eql({
        id: dataset.id,
        name: WHO_DATASET.name,
        url: WHO_DATASET.url,
        source: "WHO",
      });
    });

    it("names a dataset after its file, and describes one without summary", async () => {
      const dataset = await ctx.datasetService.connectExternalDataset(
        OWNER,
        {
          name: "World Happiness Report - Data file: 2017",
          url: "https://www.kaggle.com/datasets/unsdsn/world-happiness",
          source: "Kaggle",
          summary: "",
        },
        BACKEND,
      );
      expect(dataset.name).to.equal("World Happiness Report - 2017");
      expect(dataset.description).to.equal("Kaggle dataset");
    });

    it("returns the dataset the user connected before, but not someone else's", async () => {
      const first = await ctx.datasetService.connectExternalDataset(
        OWNER,
        WHO_DATASET,
        BACKEND,
      );
      const again = await ctx.datasetService.connectExternalDataset(
        OWNER,
        WHO_DATASET,
        BACKEND,
      );
      const other = await ctx.datasetService.connectExternalDataset(
        OTHER,
        WHO_DATASET,
        BACKEND,
      );

      expect(again.id).to.equal(first.id);
      expect(other.id).to.not.equal(first.id);
      expect(post.callCount).to.equal(2);
    });

    it("removes the dataset again when the download fails", async () => {
      post.rejects(backendFailure(500, "Unable to download."));
      await expect(
        ctx.datasetService.connectExternalDataset(OWNER, WHO_DATASET, BACKEND),
      ).to.be.rejectedWith({ statusCode: 422, message: "Unable to download." });
      expect(await ctx.datasetRepository.count()).to.eql({ count: 0 });
    });

    it("rejects malformed datasets before creating anything", async () => {
      await expectStatus(
        ctx.datasetService.connectExternalDataset(
          OWNER,
          { ...WHO_DATASET, name: "No file" },
          BACKEND,
        ),
        400,
      );
      expect(post.called).to.be.false();
    });
  });

  describe("uploadDataset", () => {
    const upload = (fileName: string, content = "a,b\n1,2\n", name?: string) =>
      ctx.datasetService.uploadDataset(
        OWNER,
        { fileName, content: Buffer.from(content), name },
        BACKEND,
      );

    it("creates a dataset named after the file and forwards its content", async () => {
      const dataset = await upload("C:\\data\\Résultats 2024.CSV");

      expect(dataset).to.containDeep({
        name: "Résultats 2024",
        description: "Uploaded from Résultats 2024.CSV",
        source: "Upload",
        fileName: "Résultats 2024.CSV",
        owner: OWNER,
      });
      const [url, data, config] = post.firstCall.args;
      expect(url).to.equal(`http://backend/upload-file/${dataset.id}`);
      expect(data.toString()).to.equal("a,b\n1,2\n");
      expect(config.params).to.eql({ filename: "upload.csv" });
      expect(config.headers.Authorization).to.equal("secret");
    });

    it("uses a provided name", async () => {
      const dataset = await upload("visits.xlsx", "x", " Clinic visits ");
      expect(dataset.name).to.equal("Clinic visits");
    });

    it("rejects unsupported and empty files before creating anything", async () => {
      await expectStatus(upload("malware.exe"), 415);
      await expectStatus(upload("no-extension"), 415);
      await expectStatus(upload("empty.csv", ""), 400);
      expect(await ctx.datasetRepository.count()).to.eql({ count: 0 });
      expect(post.called).to.be.false();
    });

    it("removes the dataset again when the file cannot be processed", async () => {
      post.rejects(backendFailure(422, "Unable to read your file."));
      await expect(upload("broken.csv")).to.be.rejectedWith({
        statusCode: 422,
        message: "Unable to read your file.",
      });
      expect(await ctx.datasetRepository.count()).to.eql({ count: 0 });
    });
  });
});
