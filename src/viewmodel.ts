import { Geometry, Point, Polygon as PixiPolygon } from "pixi.js";
import { Model, ShapeParameters } from "./model";
import * as clipperLib from "js-angusj-clipper";
import { metaballsPaths, samplePolygon } from "./polygon";
import _ from "lodash";
import poly2tri from "poly2tri";
import simplify from "simplify-js";
import { Polygon as EuclidPolygon, Point as EuclidPoint, Circle } from "@mathigon/euclid";
import { polygon2starshape, SimplePolygon } from "./polygon/polygons";
import { Position, RandomSpaceFilling } from "./polygon/space_filling";
import { CurveInterpolator } from "curve-interpolator";
import { debug, debugPolygon } from "./debug";
import { Connection } from "./gravitating_shapes";
import { SkeletonNode } from "./polygon/metaball";
const lerp = require("interpolation").lerp;

/** performs conditional recalculations of changed data to provide access to polygons and mesh geometry */
export class GeometryViewModel {
  private readonly scalingFactor = 10e4;
  private readonly clipper: clipperLib.ClipperLibWrapper;
  private model: Model;
  private polygonsUnioned: Array<Array<[number, number]>> = [];
  private polygonsUnionedScaled: clipperLib.Path[] = [];
  public skeletonGraph: Array<Connection<SkeletonNode>> = [];
  private hull: Array<Array<[number, number]>> = [];
  public stars: Position[][] = [];
  public polygonsSimplified: Array<Array<[number, number]>> = [];
  public polygons: Array<Array<[number, number]>> = [];
  public geometry: Geometry[] = [];
  public wasUpdated = false;

  constructor(model: Model, clipper: clipperLib.ClipperLibWrapper) {
    this.model = model;
    this.clipper = clipper;
    this.wasUpdated = true;

    this.setPolygonsUnionedScaled();
    this.polygonsUnioned = this.getPolygonsUnioned();
    this.polygonsSimplified = this.getPolygonsSimplified();
    this.stars = this.getStarPositions();
    this.polygons = this.getStarShapedPolygons();
    // this.geometry = this.getGeometry();
  }

  public updateModel(model: Model): void {
    const staleModel = this.model;
    this.model = model;

    const hasSamePath =
      _.isEqual(staleModel.shapeParams, model.shapeParams) && !model.shapeParams.painShapesDragging.some((p) => p);
    if (!hasSamePath) this.setPolygonsUnionedScaled();
    this.polygonsUnioned = hasSamePath ? this.polygonsUnioned : this.getPolygonsUnioned();
    this.polygonsSimplified = hasSamePath ? this.polygonsSimplified : this.getPolygonsSimplified();
    this.stars = hasSamePath ? this.stars : this.getStarPositions();

    const hasSameDissolve = staleModel.dissolve === model.dissolve;
    const hasSameStarShapeParams = _.isEqual(staleModel.starShapeParams, model.starShapeParams);
    this.polygons =
      hasSameDissolve && hasSameStarShapeParams && hasSamePath ? this.polygons : this.getStarShapedPolygons();

    /*
    const hasSameGeometry = hasSameDissolve && hasSamePath;
    this.geometry = hasSameGeometry ? this.geometry : this.getGeometry();
    */
    // this.wasUpdated = !(hasSamePath && hasSameDissolve && hasSameGeometry);
    this.wasUpdated = !(hasSamePath && hasSameStarShapeParams && hasSameDissolve);
  }

  public get hullPolygons(): Array<Array<[number, number]>> {
    const polygonsSimplified = this.hull.map((p) =>
      simplify(
        p.map(([x, y]) => ({ x, y })),
        1.0
      )
    );
    const polygonsFlat = polygonsSimplified.map((p) => p.map(({ x, y }) => [x, y] as [number, number]));
    return polygonsFlat;
  }

  private get starShapedPolygonOffset(): number {
    return lerp(0, 10, this.model.starShapeParams.outerOffsetRatio);
  }

  private getStarPositions(): Position[][] {
    // TODO also check overlap within circles
    const polygons = this.polygonsSimplified.map(
      (polygon) => new EuclidPolygon(...polygon.map(([x, y]) => new EuclidPoint(x, y)))
    );
    const starsPerPolygon = [];
    for (const polygon of polygons) {
      const positions = new RandomSpaceFilling(polygon, [2, 7]);
      const stars = positions.getPositions(0.2);
      starsPerPolygon.push(stars);
    }
    return starsPerPolygon;
  }

  private getStarShapedPolygons(): Array<Array<[number, number]>> {
    const polygonsWithoutSmallParts = this.polygonsSimplified
      .filter((polygon) => polygon.length > 3)
      .map((polygon) => ({ polygon, area: new EuclidPolygon(...polygon.map(([x, y]) => new EuclidPoint(x, y))).area }))
      .filter(({ polygon, area }) => area > 100);

    // dissolve is given as offset in the polygon's units. Completetly dissolving would be mean
    // that it has the biggest distance to the polygon's centerline. This is hard to calculate
    // so we use the polygon's area as a proxy.
    const maxDissolve = Math.max(
      ...this.model.shapeParams.painShapes.map((ps) => ps.radius),
      Math.pow(Math.max(...polygonsWithoutSmallParts.map(({ area }) => area)) / Math.PI, 1 / 2)
    );

    const polygonsDeflatedScaled =
      this.clipper
        .offsetToPaths({
          delta: -this.scalingFactor * this.model.dissolve * maxDissolve,
          offsetInputs: polygonsWithoutSmallParts.map(({ polygon }) => {
            return {
              joinType: clipperLib.JoinType.Square,
              endType: clipperLib.EndType.ClosedPolygon,
              data: polygon.map(([x, y]) => ({
                x: Math.round(x * this.scalingFactor),
                y: Math.round(y * this.scalingFactor),
              })),
            };
          }),
        })
        ?.filter((p) => this.clipper.orientation(p))
        ?.filter((p) => this.clipper.area(p) > this.scalingFactor * 100) ?? [];
    const polygonsDeflated = polygonsDeflatedScaled.map((p) =>
      p.map(({ x, y }) => [x / this.scalingFactor, y / this.scalingFactor] as [number, number])
    );

    const polygons: Array<Array<[number, number]>> = [];
    const allOuterPoints: Array<Array<[number, number]>> = [];
    for (const contourSimple of polygonsDeflated) {
      // simplified polygon leads to softer edges because there are fewer point constraints
      const interpolator = new CurveInterpolator(contourSimple, { tension: 0.0 });
      const contourSmooth: Array<[number, number]> = interpolator.getPoints(Math.min(contourSimple.length * 10, 200));
      const contour = contourSmooth;

      const { points, outerPoints } = polygon2starshape(
        contour,
        this.starShapedPolygonOffset,
        this.model.starShapeParams.roundness,
        this.model.starShapeParams.wingLength
      );

      const starShape = points;
      const simplifiedStarShape = simplify(
        starShape.map(([x, y]) => ({ x, y })),
        0.1
      );
      const starShapeScaled = simplifiedStarShape.map(({ x, y }) => ({
        x: Math.round(x * this.scalingFactor),
        y: Math.round(y * this.scalingFactor),
      }));
      const starShapesSimplified =
        this.clipper
          ?.simplifyPolygon(starShapeScaled, clipperLib.PolyFillType.NonZero)
          .map((polygon) =>
            polygon.map((p) => [p.x / this.scalingFactor, p.y / this.scalingFactor] as [number, number])
          )
          .filter((polygon) => polygon.length >= 3) ?? [];

      polygons.push(...starShapesSimplified);
      allOuterPoints.push(outerPoints);
    }
    // This is is used to construct the outer hull inside the shader, which determines the coloring
    this.hull = allOuterPoints;
    return polygons;
  }

  public getPolygonsSimplified(): Array<Array<[number, number]>> {
    const simplePolygon = this.polygonsUnioned
      .map((polygon) => polygon.map(([x, y]) => ({ x, y })))
      .map((polygon) => simplify(polygon, 5, true))
      .map((polygon) => polygon.map(({ x, y }: { x: number; y: number }) => [x, y] as [number, number]));
    return simplePolygon;
  }

  private getPolygonsUnioned(): Array<Array<[number, number]>> {
    return this.polygonsUnionedScaled.map((path) =>
      path.map(({ x, y }) => [x / this.scalingFactor, y / this.scalingFactor] as [number, number])
    );
  }

  private setPolygonsUnionedScaled(): void {
    const { paths, skeletonGraph } = metaballsPaths(this.clipper, this.model.shapeParams.painShapes, {
      ...this.model.shapeParams,
    });

    const polygonsUnionedScaled =
      this.clipper
        .clipToPaths({
          clipType: clipperLib.ClipType.Union,
          subjectFillType: clipperLib.PolyFillType.NonZero,
          subjectInputs: [...paths.entries()].flatMap(([_, polygons]) =>
            polygons.map((p) => ({
              closed: true,
              data: p.map(({ x, y }) => ({
                x: Math.round(x * this.scalingFactor),
                y: Math.round(y * this.scalingFactor),
              })),
            }))
          ),
          preserveCollinear: false,
        })
        ?.filter((p) => this.clipper.orientation(p)) ?? []; // filter out all holes, TODO consider area too

    this.polygonsUnionedScaled = polygonsUnionedScaled;
    this.skeletonGraph = skeletonGraph;
  }
}
