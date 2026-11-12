import _ from "lodash";

/**
 * Fields only the services may set. Callers must never be able to change
 * ownership or visibility (`public`/`baseline` items are listed for every user).
 */
export const SERVER_MANAGED_FIELDS = [
  "id",
  "owner",
  "public",
  "baseline",
  "createdDate",
  "updatedDate",
];

export type AccessControlled = {
  owner?: string;
  public?: boolean;
  baseline?: boolean;
};

export type HttpError = Error & { statusCode: number };

const httpError = (statusCode: number, name: string, message: string) =>
  Object.assign(new Error(message), { statusCode, name }) as HttpError;

export const forbidden = (message = "Forbidden") =>
  httpError(403, "ForbiddenError", message);

export const badRequest = (message: string) =>
  httpError(400, "BadRequestError", message);

export const omitServerManagedFields = <T extends object>(
  data: T,
  extraFields: string[] = [],
): Partial<T> => _.omit(data, [...SERVER_MANAGED_FIELDS, ...extraFields]);

/**
 * Builds a full document for `replaceById` that keeps the stored values of the
 * server-managed fields (and `extraFields`, e.g. folder placement).
 */
export const withStoredServerManagedFields = <T extends object>(
  data: T,
  stored: T,
  extraFields: string[] = [],
): T =>
  ({
    ...omitServerManagedFields(data, extraFields),
    ..._.pick(stored, [...SERVER_MANAGED_FIELDS, ...extraFields]),
    updatedDate: new Date().toISOString(),
  }) as T;

export const isOwner = (item: AccessControlled, userId: string) =>
  Boolean(userId) && item.owner === userId;

export const canRead = (item: AccessControlled, userIds: string[]) =>
  Boolean(item.public) ||
  Boolean(item.baseline) ||
  userIds.some((userId) => isOwner(item, userId));

export const assertOwner = (
  item: AccessControlled,
  userId: string,
  message = "Forbidden: You do not own this item",
) => {
  if (!isOwner(item, userId)) {
    throw forbidden(message);
  }
};

export const assertCanRead = (
  item: AccessControlled,
  userIds: string[],
  message = "Forbidden: You do not have access to this item",
) => {
  if (!canRead(item, userIds)) {
    throw forbidden(message);
  }
};

export const unsupportedMediaType = (message: string) =>
  httpError(415, "UnsupportedMediaTypeError", message);

export const unprocessable = (message: string) =>
  httpError(422, "UnprocessableEntityError", message);

export const badGateway = (message: string) =>
  httpError(502, "BadGatewayError", message);

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Ids are interpolated into file paths and backend URLs, so only plain
 * identifiers (Mongo ids, dataset names like `gf_allocations`) are allowed.
 */
export const assertSafeId = (value: unknown, label = "id"): string => {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw badRequest(`Invalid ${label}`);
  }
  return value;
};
