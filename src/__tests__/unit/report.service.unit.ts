import { expect, sinon } from "@loopback/testlab";
import { ReportModel } from "../../models";
import { expectStatus, givenServices, OTHER, OWNER } from "./fixtures";

describe("ReportService (unit)", () => {
  let ctx: ReturnType<typeof givenServices>;

  beforeEach(() => {
    sinon.stub(console, "log");
    ctx = givenServices();
  });

  afterEach(() => sinon.restore());

  const givenReport = (data: Partial<ReportModel> = {}) =>
    ctx.reportRepository.create({ name: "Report", owner: OWNER, ...data });

  const givenFolder = (owner = OWNER) =>
    ctx.folderRepository.create({ name: "Folder", owner });

  describe("create", () => {
    it("ignores client-supplied server-managed fields", async () => {
      const report = await ctx.reportService.create(OWNER, {
        name: "New",
        owner: OTHER,
        public: true,
        baseline: true,
        createdDate: "2000-01-01T00:00:00.000Z",
      } as ReportModel);

      const stored = await ctx.reportRepository.findById(report.id);
      expect(stored).to.containDeep({
        name: "New",
        owner: OWNER,
        public: false,
        baseline: false,
      });
      expect(new Date(stored.createdDate).getFullYear()).to.not.equal(2000);
    });

    it("rejects a folderId the caller does not own", async () => {
      const folder = await givenFolder(OTHER);
      await expectStatus(
        ctx.reportService.create(OWNER, {
          name: "New",
          folderId: folder.id,
        } as ReportModel),
        403,
      );
      expect((await ctx.reportRepository.count()).count).to.equal(0);
    });

    it("accepts a folderId the caller owns", async () => {
      const folder = await givenFolder();
      const report = await ctx.reportService.create(OWNER, {
        name: "New",
        folderId: folder.id,
      } as ReportModel);
      expect(report.folderId).to.equal(folder.id);
    });
  });

  describe("findById", () => {
    it("throws 403 for another user's private report", async () => {
      const report = await givenReport();
      await expectStatus(ctx.reportService.findById([OTHER], report.id), 403);
    });

    it("returns public and baseline reports to anyone", async () => {
      const publicReport = await givenReport({ public: true });
      const baselineReport = await givenReport({ baseline: true });
      expect(
        (await ctx.reportService.findById([OTHER], publicReport.id)).id,
      ).to.equal(publicReport.id);
      expect(
        (await ctx.reportService.findById([OTHER], baselineReport.id)).id,
      ).to.equal(baselineReport.id);
    });
  });

  describe("updateById", () => {
    it("ignores server-managed fields and folderId", async () => {
      const folder = await givenFolder();
      const report = await givenReport({ folderId: folder.id });

      await ctx.reportService.updateById(OWNER, report.id, {
        name: "Renamed",
        id: "another-id",
        owner: OTHER,
        public: true,
        baseline: true,
        folderId: "another-folder",
        createdDate: "2000-01-01T00:00:00.000Z",
      } as ReportModel);

      const stored = await ctx.reportRepository.findById(report.id);
      expect(stored).to.containDeep({
        name: "Renamed",
        owner: OWNER,
        public: false,
        baseline: false,
        folderId: folder.id,
      });
      expect(stored.createdDate).to.eql(report.createdDate);
      expect((await ctx.reportRepository.count()).count).to.equal(1);
    });

    it("throws 403 for a non-owner and leaves the report unchanged", async () => {
      const report = await givenReport({ public: true });
      await expectStatus(
        ctx.reportService.updateById(OTHER, report.id, {
          name: "Hijacked",
        } as ReportModel),
        403,
      );
      expect((await ctx.reportRepository.findById(report.id)).name).to.equal(
        "Report",
      );
    });

    it("throws 403 when neither the caller nor the report has an owner", async () => {
      const report = await ctx.reportRepository.create({
        name: "Ownerless",
        baseline: true,
      });
      await expectStatus(
        ctx.reportService.updateById("", report.id, {
          name: "Hijacked",
        } as ReportModel),
        403,
      );
    });
  });

  describe("replaceById", () => {
    it("keeps the stored server-managed fields and folder", async () => {
      const folder = await givenFolder();
      const report = await givenReport({ public: true, folderId: folder.id });

      await ctx.reportService.replaceById(OWNER, report.id, {
        name: "Replaced",
        owner: OTHER,
        public: false,
        baseline: true,
        folderId: "another-folder",
      } as ReportModel);

      const stored = await ctx.reportRepository.findById(report.id);
      expect(stored).to.containDeep({
        name: "Replaced",
        owner: OWNER,
        public: true,
        baseline: false,
        folderId: folder.id,
      });
      expect(stored.createdDate).to.eql(report.createdDate);
    });

    it("throws 403 for a non-owner", async () => {
      const report = await givenReport();
      await expectStatus(
        ctx.reportService.replaceById(OTHER, report.id, {
          name: "Replaced",
        } as ReportModel),
        403,
      );
      expect((await ctx.reportRepository.findById(report.id)).name).to.equal(
        "Report",
      );
    });
  });

  describe("deleteById", () => {
    it("throws 403 for a non-owner and keeps the report", async () => {
      const report = await givenReport({ public: true });
      await expectStatus(ctx.reportService.deleteById(OTHER, report.id), 403);
      expect(await ctx.reportRepository.exists(report.id)).to.be.true();
    });

    it("deletes the caller's own report", async () => {
      const report = await givenReport();
      await ctx.reportService.deleteById(OWNER, report.id);
      expect(await ctx.reportRepository.exists(report.id)).to.be.false();
    });
  });

  describe("duplicate", () => {
    it("throws 403 for another user's private report", async () => {
      const report = await givenReport();
      await expectStatus(ctx.reportService.duplicate(OTHER, report.id), 403);
      expect((await ctx.reportRepository.count()).count).to.equal(1);
    });

    it("copies public and baseline reports into a private copy", async () => {
      for (const flags of [{ public: true }, { baseline: true }]) {
        const report = await givenReport(flags);
        const copy = await ctx.reportService.duplicate(OTHER, report.id);
        expect(copy).to.containDeep({
          name: "Report (Copy)",
          owner: OTHER,
          public: false,
          baseline: false,
        });
      }
    });
  });
});
