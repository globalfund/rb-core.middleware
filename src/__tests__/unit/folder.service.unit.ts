import { expect, sinon } from "@loopback/testlab";
import { FolderModel } from "../../models";
import { expectStatus, givenServices, OTHER, OWNER } from "./fixtures";

const ROOT = "__root__";

describe("FolderService (unit)", () => {
  let ctx: ReturnType<typeof givenServices>;

  beforeEach(() => {
    sinon.stub(console, "log");
    ctx = givenServices();
  });

  afterEach(() => sinon.restore());

  const givenFolder = (data: Partial<FolderModel> = {}) =>
    ctx.folderRepository.create({ name: "Folder", owner: OWNER, ...data });

  const parentOf = async (id: string) =>
    (await ctx.folderRepository.findById(id)).parentId;

  describe("create", () => {
    it("ignores client-supplied server-managed fields", async () => {
      const folder = await ctx.folderService.create(OWNER, {
        name: "New",
        owner: OTHER,
        public: true,
      } as FolderModel);

      expect(await ctx.folderRepository.findById(folder.id)).to.containDeep({
        owner: OWNER,
        public: false,
      });
    });

    it("rejects a parent folder the caller does not own", async () => {
      const parent = await givenFolder({ owner: OTHER, public: true });
      await expectStatus(
        ctx.folderService.create(OWNER, {
          name: "New",
          parentId: parent.id,
        } as FolderModel),
        403,
      );
      expect((await ctx.folderRepository.count()).count).to.equal(1);
    });

    it("creates inside a parent folder the caller owns", async () => {
      const parent = await givenFolder();
      const folder = await ctx.folderService.create(OWNER, {
        name: "New",
        parentId: parent.id,
      } as FolderModel);
      expect(folder.parentId).to.equal(parent.id);
    });
  });

  describe("findById", () => {
    it("throws 403 for another user's private folder", async () => {
      const folder = await givenFolder();
      await expectStatus(ctx.folderService.findById([OTHER], folder.id), 403);
    });

    it("returns another user's public folder", async () => {
      const folder = await givenFolder({ public: true });
      expect(
        (await ctx.folderService.findById([OTHER], folder.id)).id,
      ).to.equal(folder.id);
    });
  });

  describe("updateById", () => {
    it("ignores server-managed fields and parentId", async () => {
      const parent = await givenFolder();
      const folder = await givenFolder({ parentId: parent.id });

      await ctx.folderService.updateById(OWNER, folder.id, {
        name: "Renamed",
        owner: OTHER,
        public: true,
        parentId: folder.id,
      } as FolderModel);

      expect(await ctx.folderRepository.findById(folder.id)).to.containDeep({
        name: "Renamed",
        owner: OWNER,
        public: false,
        parentId: parent.id,
      });
    });

    it("throws 403 for a non-owner", async () => {
      const folder = await givenFolder({ public: true });
      await expectStatus(
        ctx.folderService.updateById(OTHER, folder.id, {
          name: "Hijacked",
        } as FolderModel),
        403,
      );
    });
  });

  describe("replaceById", () => {
    it("keeps the stored server-managed fields and parent", async () => {
      const parent = await givenFolder();
      const folder = await givenFolder({ parentId: parent.id, public: true });

      await ctx.folderService.replaceById(OWNER, folder.id, {
        name: "Replaced",
        owner: OTHER,
        public: false,
      } as FolderModel);

      expect(await ctx.folderRepository.findById(folder.id)).to.containDeep({
        name: "Replaced",
        owner: OWNER,
        public: true,
        parentId: parent.id,
      });
    });
  });

  describe("deleteById", () => {
    it("throws 403 for a non-owner and keeps the folder", async () => {
      const folder = await givenFolder({ public: true });
      await expectStatus(ctx.folderService.deleteById(OTHER, folder.id), 403);
      expect(await ctx.folderRepository.exists(folder.id)).to.be.true();
    });
  });

  describe("duplicate", () => {
    it("throws 403 for another user's private folder", async () => {
      const folder = await givenFolder();
      await expectStatus(ctx.folderService.duplicate(OTHER, folder.id), 403);
      expect((await ctx.folderRepository.count()).count).to.equal(1);
    });

    it("copies another user's public folder into a private copy", async () => {
      const folder = await givenFolder({ public: true });
      const copy = await ctx.folderService.duplicate(OTHER, folder.id);
      expect(copy).to.containDeep({
        name: "Folder (Copy)",
        owner: OTHER,
        public: false,
      });
    });
  });

  describe("addReport", () => {
    it("throws 403 when moving another user's report to the root", async () => {
      const theirFolder = await givenFolder({ owner: OTHER });
      const report = await ctx.reportRepository.create({
        name: "Theirs",
        owner: OTHER,
        folderId: theirFolder.id,
      });

      await expectStatus(
        ctx.folderService.addReport(OWNER, ROOT, report.id),
        403,
      );
      expect(
        (await ctx.reportRepository.findById(report.id)).folderId,
      ).to.equal(theirFolder.id);
    });

    it("throws 403 when moving another user's public or baseline report", async () => {
      const folder = await givenFolder();
      for (const flags of [{ public: true }, { baseline: true }]) {
        const report = await ctx.reportRepository.create({
          name: "Theirs",
          owner: OTHER,
          ...flags,
        });
        await expectStatus(
          ctx.folderService.addReport(OWNER, folder.id, report.id),
          403,
        );
        expect(
          (await ctx.reportRepository.findById(report.id)).folderId,
        ).to.be.undefined();
      }
    });

    it("throws 403 for a target folder the caller does not own", async () => {
      const folder = await givenFolder({ owner: OTHER });
      const report = await ctx.reportRepository.create({ owner: OWNER });
      await expectStatus(
        ctx.folderService.addReport(OWNER, folder.id, report.id),
        403,
      );
    });

    it("moves the caller's own report into a folder and back to the root", async () => {
      const folder = await givenFolder();
      const report = await ctx.reportRepository.create({ owner: OWNER });

      await ctx.folderService.addReport(OWNER, folder.id, report.id);
      expect(
        (await ctx.reportRepository.findById(report.id)).folderId,
      ).to.equal(folder.id);

      const root = await ctx.folderService.addReport(
        OWNER,
        ROOT,
        report.id,
        folder.id,
      );
      expect(root.id).to.equal(ROOT);
      expect(
        (await ctx.reportRepository.findById(report.id)).folderId,
      ).to.be.undefined();
    });
  });

  describe("addAsset", () => {
    it("throws 403 when moving another user's public or baseline asset", async () => {
      const folder = await givenFolder();
      for (const flags of [{ public: true }, { baseline: true }]) {
        const asset = await ctx.assetRepository.create({
          name: "Theirs",
          owner: OTHER,
          ...flags,
        });
        await expectStatus(
          ctx.folderService.addAsset(OWNER, folder.id, asset.id),
          403,
        );
        expect(
          (await ctx.assetRepository.findById(asset.id)).folderId,
        ).to.be.undefined();
      }
    });

    it("moves the caller's own asset", async () => {
      const folder = await givenFolder();
      const asset = await ctx.assetRepository.create({ owner: OWNER });
      await ctx.folderService.addAsset(OWNER, folder.id, asset.id);
      expect((await ctx.assetRepository.findById(asset.id)).folderId).to.equal(
        folder.id,
      );
    });
  });

  describe("addFolder", () => {
    it("throws 403 when moving another user's folder to the root", async () => {
      const theirParent = await givenFolder({ owner: OTHER });
      const theirs = await givenFolder({
        owner: OTHER,
        parentId: theirParent.id,
      });

      await expectStatus(
        ctx.folderService.addFolder(OWNER, ROOT, theirs.id),
        403,
      );
      expect(await parentOf(theirs.id)).to.equal(theirParent.id);
    });

    it("throws 403 when moving another user's public folder", async () => {
      const target = await givenFolder();
      const theirs = await givenFolder({ owner: OTHER, public: true });
      await expectStatus(
        ctx.folderService.addFolder(OWNER, target.id, theirs.id),
        403,
      );
      expect(await parentOf(theirs.id)).to.be.undefined();
    });

    it("throws 403 for a target folder the caller does not own", async () => {
      const target = await givenFolder({ owner: OTHER });
      const folder = await givenFolder();
      await expectStatus(
        ctx.folderService.addFolder(OWNER, target.id, folder.id),
        403,
      );
    });

    it("throws 400 when moving a folder into itself", async () => {
      const folder = await givenFolder();
      await expectStatus(
        ctx.folderService.addFolder(OWNER, folder.id, folder.id),
        400,
      );
      expect(await parentOf(folder.id)).to.be.undefined();
    });

    it("throws 400 when moving a folder under its own descendant", async () => {
      const top = await givenFolder();
      const child = await givenFolder({ parentId: top.id });
      const grandchild = await givenFolder({ parentId: child.id });

      await expectStatus(
        ctx.folderService.addFolder(OWNER, grandchild.id, top.id),
        400,
      );
      expect(await parentOf(top.id)).to.be.undefined();
    });

    it("stops walking when the stored tree already has a cycle", async () => {
      const a = await givenFolder();
      const b = await givenFolder({ parentId: a.id });
      await ctx.folderRepository.updateById(a.id, { parentId: b.id });
      const c = await givenFolder();

      await ctx.folderService.addFolder(OWNER, a.id, c.id);
      expect(await parentOf(c.id)).to.equal(a.id);
    });

    it("moves the caller's own folder into a folder and back to the root", async () => {
      const target = await givenFolder();
      const folder = await givenFolder();

      await ctx.folderService.addFolder(OWNER, target.id, folder.id);
      expect(await parentOf(folder.id)).to.equal(target.id);

      await ctx.folderService.addFolder(OWNER, ROOT, folder.id, target.id);
      expect(await parentOf(folder.id)).to.be.undefined();
    });
  });

  describe("getFolderPath", () => {
    const pathIds = async (id: string) =>
      (await ctx.folderService.getFolderPath(OWNER, id)).map((f) => f.id);

    it("returns the folders from the root down", async () => {
      const top = await givenFolder();
      const child = await givenFolder({ parentId: top.id });
      const grandchild = await givenFolder({ parentId: child.id });

      expect(await pathIds(grandchild.id)).to.deepEqual([
        top.id,
        child.id,
        grandchild.id,
      ]);
    });

    it("stops when the stored tree already has a cycle", async () => {
      const a = await givenFolder();
      const b = await givenFolder({ parentId: a.id });
      await ctx.folderRepository.updateById(a.id, { parentId: b.id });
      const self = await givenFolder();
      await ctx.folderRepository.updateById(self.id, { parentId: self.id });

      expect(await pathIds(b.id)).to.deepEqual([a.id, b.id]);
      expect(await pathIds(self.id)).to.deepEqual([self.id]);
    });

    it("stops at a parent that no longer exists", async () => {
      const top = await givenFolder();
      const child = await givenFolder({ parentId: top.id });
      await ctx.folderRepository.deleteById(top.id);

      expect(await pathIds(child.id)).to.deepEqual([child.id]);
    });
  });

  describe("moveFolder", () => {
    it("throws 403 for another user's folder", async () => {
      const theirs = await givenFolder({ owner: OTHER });
      await expectStatus(ctx.folderService.moveFolder(OWNER, theirs.id), 403);
    });

    it("throws 400 when moving a folder under its own descendant", async () => {
      const top = await givenFolder();
      const child = await givenFolder({ parentId: top.id });
      await expectStatus(
        ctx.folderService.moveFolder(OWNER, top.id, child.id),
        400,
      );
      expect(await parentOf(top.id)).to.be.undefined();
    });
  });
});
