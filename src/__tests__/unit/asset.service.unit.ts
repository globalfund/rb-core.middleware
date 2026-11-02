import { expect, sinon } from "@loopback/testlab";
import { AssetModel } from "../../models";
import { expectStatus, givenServices, OTHER, OWNER } from "./fixtures";

describe("AssetService (unit)", () => {
  let ctx: ReturnType<typeof givenServices>;

  beforeEach(() => {
    sinon.stub(console, "log");
    ctx = givenServices();
  });

  afterEach(() => sinon.restore());

  const givenAsset = (data: Partial<AssetModel> = {}) =>
    ctx.assetRepository.create({
      name: "Asset",
      type: "text",
      owner: OWNER,
      ...data,
    });

  const givenFolder = (owner = OWNER) =>
    ctx.folderRepository.create({ name: "Folder", owner, type: "asset" });

  describe("create", () => {
    it("ignores client-supplied server-managed fields", async () => {
      const asset = await ctx.assetService.create(OWNER, {
        name: "New",
        owner: OTHER,
        public: true,
        baseline: true,
      } as AssetModel);

      expect(await ctx.assetRepository.findById(asset.id)).to.containDeep({
        owner: OWNER,
        public: false,
        baseline: false,
      });
    });

    it("rejects a folderId the caller does not own", async () => {
      const folder = await givenFolder(OTHER);
      await expectStatus(
        ctx.assetService.create(OWNER, {
          name: "New",
          folderId: folder.id,
        } as AssetModel),
        403,
      );
    });
  });

  describe("findById", () => {
    it("throws 403 for another user's private asset", async () => {
      const asset = await givenAsset();
      await expectStatus(ctx.assetService.findById([OTHER], asset.id), 403);
    });
  });

  describe("updateById", () => {
    it("ignores server-managed fields and folderId", async () => {
      const folder = await givenFolder();
      const asset = await givenAsset({ folderId: folder.id });

      await ctx.assetService.updateById(OWNER, asset.id, {
        name: "Renamed",
        owner: OTHER,
        public: true,
        baseline: true,
        folderId: "another-folder",
      } as AssetModel);

      expect(await ctx.assetRepository.findById(asset.id)).to.containDeep({
        name: "Renamed",
        owner: OWNER,
        public: false,
        baseline: false,
        folderId: folder.id,
      });
    });

    it("throws 403 for a non-owner", async () => {
      const asset = await givenAsset({ baseline: true });
      await expectStatus(
        ctx.assetService.updateById(OTHER, asset.id, {
          name: "Hijacked",
        } as AssetModel),
        403,
      );
      expect((await ctx.assetRepository.findById(asset.id)).name).to.equal(
        "Asset",
      );
    });
  });

  describe("replaceById", () => {
    it("keeps the stored server-managed fields and folder", async () => {
      const folder = await givenFolder();
      const asset = await givenAsset({ baseline: true, folderId: folder.id });

      await ctx.assetService.replaceById(OWNER, asset.id, {
        name: "Replaced",
        type: "text",
        owner: OTHER,
        baseline: false,
      } as AssetModel);

      expect(await ctx.assetRepository.findById(asset.id)).to.containDeep({
        name: "Replaced",
        owner: OWNER,
        baseline: true,
        folderId: folder.id,
      });
    });

    it("throws 403 for a non-owner", async () => {
      const asset = await givenAsset();
      await expectStatus(
        ctx.assetService.replaceById(OTHER, asset.id, {
          name: "Replaced",
        } as AssetModel),
        403,
      );
    });
  });

  describe("deleteById", () => {
    it("throws 403 for a non-owner and keeps the asset", async () => {
      const asset = await givenAsset({ public: true });
      await expectStatus(ctx.assetService.deleteById(OTHER, asset.id), 403);
      expect(await ctx.assetRepository.exists(asset.id)).to.be.true();
    });
  });

  describe("duplicate", () => {
    it("throws 403 for another user's private asset", async () => {
      const asset = await givenAsset();
      await expectStatus(ctx.assetService.duplicate(OTHER, asset.id), 403);
      expect((await ctx.assetRepository.count()).count).to.equal(1);
    });

    it("copies a baseline asset into a private copy", async () => {
      const asset = await givenAsset({ baseline: true });
      const copy = await ctx.assetService.duplicate(OTHER, asset.id);
      expect(copy).to.containDeep({
        name: "Asset (Copy)",
        owner: OTHER,
        public: false,
        baseline: false,
      });
    });
  });

  describe("folder access", () => {
    it("addToFolder throws 403 for another user's asset", async () => {
      const folder = await givenFolder();
      const asset = await givenAsset({ owner: OTHER, public: true });
      await expectStatus(
        ctx.assetService.addToFolder(OWNER, asset.id, folder.id),
        403,
      );
      expect(
        (await ctx.assetRepository.findById(asset.id)).folderId,
      ).to.be.undefined();
    });

    it("addToFolder throws 403 for another user's folder", async () => {
      const folder = await givenFolder(OTHER);
      const asset = await givenAsset();
      await expectStatus(
        ctx.assetService.addToFolder(OWNER, asset.id, folder.id),
        403,
      );
    });

    it("removeFromFolder throws 403 for another user's asset", async () => {
      const folder = await givenFolder();
      const asset = await givenAsset({ owner: OTHER, folderId: folder.id });
      await expectStatus(
        ctx.assetService.removeFromFolder(OWNER, asset.id, folder.id),
        403,
      );
      expect((await ctx.assetRepository.findById(asset.id)).folderId).to.equal(
        folder.id,
      );
    });

    it("getFolder throws 403 for another user's private asset", async () => {
      const asset = await givenAsset();
      await expectStatus(ctx.assetService.getFolder(OTHER, asset.id), 403);
    });
  });
});
