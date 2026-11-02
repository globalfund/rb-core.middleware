import { expect, sinon } from "@loopback/testlab";
import { ChartModel } from "../../models";
import {
  chartData,
  expectStatus,
  givenServices,
  OTHER,
  OWNER,
} from "./fixtures";

describe("ChartService (unit)", () => {
  let ctx: ReturnType<typeof givenServices>;

  beforeEach(() => {
    sinon.stub(console, "log");
    ctx = givenServices();
  });

  afterEach(() => sinon.restore());

  const givenChart = (data: Partial<ChartModel> = {}) =>
    ctx.chartRepository.create(chartData({ owner: OWNER, ...data }));

  describe("create", () => {
    it("ignores client-supplied server-managed fields", async () => {
      const chart = await ctx.chartService.create(
        OWNER,
        chartData({
          owner: OTHER,
          public: true,
          baseline: true,
        }) as ChartModel,
      );

      expect(await ctx.chartRepository.findById(chart.id)).to.containDeep({
        owner: OWNER,
        public: false,
        baseline: false,
      });
    });
  });

  describe("findById", () => {
    it("throws 403 for another user's private chart", async () => {
      const chart = await givenChart();
      await expectStatus(ctx.chartService.findById(chart.id, [OTHER]), 403);
    });

    it("checks access on cached charts too", async () => {
      const chart = await givenChart();
      await ctx.chartService.findById(chart.id, [OWNER]);
      expect(ctx.redisClient.store.size).to.be.above(0);

      await expectStatus(ctx.chartService.findById(chart.id, [OTHER]), 403);
      expect((await ctx.chartService.findById(chart.id, [OWNER])).id).to.equal(
        chart.id,
      );
    });
  });

  describe("findById cache", () => {
    const fields = { fields: { id: true, name: true, owner: true } };

    // Caches the chart under both the default and a filtered key.
    const givenCachedChart = async () => {
      const chart = await givenChart();
      await ctx.chartService.findById(chart.id, [OWNER]);
      await ctx.chartService.findById(chart.id, [OWNER], fields);
      return chart;
    };

    const cachedName = async (id: string, filter?: typeof fields) =>
      (await ctx.chartService.findById(id, [OWNER], filter)).name;

    it("serves the new name after updateById", async () => {
      const chart = await givenCachedChart();
      await ctx.chartService.updateById(chart.id, OWNER, {
        name: "Renamed",
      } as ChartModel);

      expect(await cachedName(chart.id)).to.equal("Renamed");
      expect(await cachedName(chart.id, fields)).to.equal("Renamed");
    });

    it("serves the new name after replaceById", async () => {
      const chart = await givenCachedChart();
      await ctx.chartService.replaceById(
        chart.id,
        OWNER,
        chartData({ name: "Replaced" }) as ChartModel,
      );

      expect(await cachedName(chart.id)).to.equal("Replaced");
      expect(await cachedName(chart.id, fields)).to.equal("Replaced");
    });

    it("stops serving a deleted chart", async () => {
      const chart = await givenCachedChart();
      await ctx.chartService.deleteById(chart.id, OWNER);

      for (const filter of [undefined, fields]) {
        await expect(
          ctx.chartService.findById(chart.id, [OWNER], filter),
        ).to.be.rejectedWith({ code: "ENTITY_NOT_FOUND" });
      }
    });

    it("keeps other charts' entries", async () => {
      const chart = await givenCachedChart();
      const other = await givenChart({ name: "Other" });
      await ctx.chartService.findById(other.id, [OWNER]);

      await ctx.chartService.deleteById(chart.id, OWNER);
      expect([...ctx.redisClient.store.keys()]).to.containEql(
        `chart-detail-${other.id}-undefined`,
      );
    });
  });

  describe("updateById", () => {
    it("ignores server-managed fields and returns the stored chart", async () => {
      const chart = await givenChart();

      const updated = await ctx.chartService.updateById(chart.id, OWNER, {
        name: "Renamed",
        owner: OTHER,
        public: true,
        baseline: true,
      } as ChartModel);

      expect(updated).to.containDeep({
        id: chart.id,
        name: "Renamed",
        owner: OWNER,
        public: false,
        baseline: false,
      });
    });

    it("throws 403 for a non-owner", async () => {
      const chart = await givenChart({ public: true });
      await expectStatus(
        ctx.chartService.updateById(chart.id, OTHER, {
          name: "Hijacked",
        } as ChartModel),
        403,
      );
      expect((await ctx.chartRepository.findById(chart.id)).name).to.equal(
        "Chart",
      );
    });
  });

  describe("replaceById", () => {
    it("keeps the stored server-managed fields", async () => {
      const chart = await givenChart({ baseline: true });

      await ctx.chartService.replaceById(
        chart.id,
        OWNER,
        chartData({
          name: "Replaced",
          owner: OTHER,
          baseline: false,
        }) as ChartModel,
      );

      expect(await ctx.chartRepository.findById(chart.id)).to.containDeep({
        name: "Replaced",
        owner: OWNER,
        baseline: true,
      });
    });

    it("throws 403 for a non-owner", async () => {
      const chart = await givenChart();
      await expectStatus(
        ctx.chartService.replaceById(
          chart.id,
          OTHER,
          chartData({ name: "Replaced" }) as ChartModel,
        ),
        403,
      );
    });
  });

  describe("deleteById", () => {
    it("throws 403 for a non-owner and keeps the chart", async () => {
      const chart = await givenChart({ public: true });
      await expectStatus(ctx.chartService.deleteById(chart.id, OTHER), 403);
      expect(await ctx.chartRepository.exists(chart.id)).to.be.true();
    });
  });

  describe("duplicate", () => {
    it("throws 403 for another user's private chart", async () => {
      const chart = await givenChart();
      await expectStatus(ctx.chartService.duplicate(chart.id, OTHER), 403);
      expect((await ctx.chartRepository.count()).count).to.equal(1);
    });

    it("copies a public chart into a private copy", async () => {
      const chart = await givenChart({ public: true });
      const copy = await ctx.chartService.duplicate(chart.id, OTHER);
      expect(copy).to.containDeep({
        name: "Chart (Copy)",
        owner: OTHER,
        public: false,
        baseline: false,
      });
    });
  });

  describe("sampleData", () => {
    it("throws 403 for another user's private dataset", async () => {
      const dataset = await ctx.datasetRepository.create({
        name: "Dataset",
        description: "Description",
        public: false,
        category: "Category",
        source: "Source",
        owner: OWNER,
      });
      await expectStatus(
        ctx.chartService.sampleData(dataset.id!, [OTHER], "http://unused"),
        403,
      );
    });
  });

  describe("renderById", () => {
    it("throws 403 for another user's private chart", async () => {
      const chart = await givenChart();
      await expectStatus(
        ctx.chartService.renderById(chart.id, OTHER, { rows: [] }, "/unused/"),
        403,
      );
    });
  });
});
