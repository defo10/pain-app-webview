import { Geometry, Point } from "pixi.js";
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

/** performs conditional recalculations of changed data to provide access to polygons and mesh geometry */
export class GeometryViewModel {
  private readonly scalingFactor = 10e4;
  private readonly clipper: clipperLib.ClipperLibWrapper;
  private model: Model;
  private polygonsUnioned: Array<Array<[number, number]>> = [];
  public stars: Position[][] = [];
  public polygonsSimplified: Array<Array<[number, number]>> = [];
  public polygons: Array<Array<[number, number]>> = [];
  public geometry: Geometry[] = [];
  public wasUpdated = false;

  constructor(model: Model, clipper: clipperLib.ClipperLibWrapper) {
    this.model = model;
    this.clipper = clipper;
    this.wasUpdated = true;

    this.polygonsUnioned = this.getPolygonsUnioned();
    this.polygonsSimplified = this.getPolygonsSimplified();
    this.stars = this.getStars();
    this.polygons = this.getStarShapedPolygons();
    // this.geometry = this.getGeometry();
  }

  public updateModel(model: Model): void {
    const staleModel = this.model;
    this.model = model;

    const hasSamePath =
      _.isEqual(staleModel.shapeParams, model.shapeParams) && !model.shapeParams.painShapesDragging.some((p) => p);
    this.polygonsUnioned = hasSamePath ? this.polygonsUnioned : this.getPolygonsUnioned();
    this.polygonsSimplified = hasSamePath ? this.polygonsSimplified : this.getPolygonsSimplified();
    this.stars = hasSamePath ? this.stars : this.getStars();

    const hasSameDissolve = staleModel.dissolve === model.dissolve;
    this.polygons = hasSameDissolve && hasSamePath ? this.polygons : this.getStarShapedPolygons();

    /*
    const hasSameGeometry = hasSameDissolve && hasSamePath;
    this.geometry = hasSameGeometry ? this.geometry : this.getGeometry();
    */
    // this.wasUpdated = !(hasSamePath && hasSameDissolve && hasSameGeometry);
    this.wasUpdated = !(hasSamePath && hasSameDissolve);
  }

  private getStars(): Position[][] {
    // TODO also check overlap within circles
    const polygons = this.polygonsSimplified.map(
      (polygon) => new EuclidPolygon(...polygon.map(([x, y]) => new EuclidPoint(x, y)))
    );
    const starsPerPolygon = [];
    for (const polygon of polygons) {
      const positions = new RandomSpaceFilling(polygon, [4, 10]);
      const stars = positions.getPositions(10);
      starsPerPolygon.push(stars);
    }
    return starsPerPolygon;
  }

  private getStarShapedPolygons(): Array<Array<[number, number]>> {
    const polygonsUnionedScaled =
      this.clipper
        .offsetToPaths({
          delta: -this.scalingFactor * this.model.dissolve,
          offsetInputs: this.polygonsSimplified.map((path) => {
            return {
              joinType: clipperLib.JoinType.Square,
              endType: clipperLib.EndType.ClosedPolygon,
              data: path.map(([x, y]) => ({
                x: Math.round(x * this.scalingFactor),
                y: Math.round(y * this.scalingFactor),
              })),
            };
          }),
        })
        ?.filter((p) => this.clipper.orientation(p)) ?? [];
    const polygonsSimplifiedUnscaled = polygonsUnionedScaled.map((p) =>
      p.map(({ x, y }) => [x / this.scalingFactor, y / this.scalingFactor] as [number, number])
    );

    const polygons: Array<Array<[number, number]>> = [];
    for (const contourSimple of polygonsSimplifiedUnscaled) {
      const interpolator = new CurveInterpolator(contourSimple, { tension: 0.0 });
      const contourSmooth: Array<[number, number]> = interpolator.getPoints(Math.min(contourSimple.length * 10, 200));
      const contour = contourSmooth;

      const starShape = polygon2starshape(
        contour,
        this.model.starShapeParams.innerOffset,
        this.model.starShapeParams.roundness,
        this.model.starShapeParams.wingLength
      );
      const scalingFactor = 10e7;
      const simplifiedStarShape = simplify(
        starShape.map(([x, y]) => ({ x, y })),
        0.1
      );
      const starShapeScaled = simplifiedStarShape.map(({ x, y }) => ({
        x: Math.round(x * scalingFactor),
        y: Math.round(y * scalingFactor),
      }));
      const starShapesSimplified =
        this.clipper
          ?.simplifyPolygon(starShapeScaled, clipperLib.PolyFillType.NonZero)
          .map((polygon) => polygon.map((p) => ({ x: p.x / scalingFactor, y: p.y / scalingFactor })))
          .map((polygon) => simplify(polygon, 0.3).map(({ x, y }) => [x, y] as [number, number])) ?? [];

      polygons.push(...starShapesSimplified);
    }

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
    const { paths } = metaballsPaths(this.clipper, this.model.shapeParams.painShapes, { ...this.model.shapeParams });

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

    return polygonsUnionedScaled.map((path) =>
      path.map(({ x, y }) => [x / this.scalingFactor, y / this.scalingFactor] as [number, number])
    );
  }
}
