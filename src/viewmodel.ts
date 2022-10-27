import { Geometry } from "pixi.js";
import { ShapeParameters } from "./model";
import * as clipperLib from "js-angusj-clipper";
import { metaballsPaths, samplePolygon } from "./polygon";
import _ from "lodash";
import poly2tri from "poly2tri";
import { polyon2starshape } from "./polygon/polygons";
import simplify from "simplify-js";

/** performs conditional recalculations of changed data to provide access to polygons and mesh geometry */
export class GeometryViewModel {
  private readonly scalingFactor = 10e4;
  private readonly clipper: clipperLib.ClipperLibWrapper;
  private model: ShapeParameters;
  private dissolve: number;
  /** polygons that have been scaled using scalingFactor before bc clipperLib works on integers */
  private polygonsUnionedScaled: clipperLib.Path[] = [];

  public polygons: Array<Array<[number, number]>> = [];
  public geometry: Geometry[] = [];
  public wasUpdated = false;

  constructor(model: ShapeParameters, dissolve: number, clipper: clipperLib.ClipperLibWrapper) {
    this.model = model;
    this.dissolve = dissolve;
    this.clipper = clipper;
    this.wasUpdated = true;

    this.polygonsUnionedScaled = this.getPolygonsUnionedScaled();
    this.polygons = this.getPolygons();
    this.geometry = this.getGeometry();
  }

  public updateModel(model: ShapeParameters, dissolve: number): void {
    const staleModel = this.model;
    this.model = model;
    const staleDissolve = this.dissolve;
    this.dissolve = dissolve;

    const hasSamePath = _.isEqual(staleModel, model) && !model.painShapesDragging.some((p) => p);
    this.polygonsUnionedScaled = hasSamePath ? this.polygonsUnionedScaled : this.getPolygonsUnionedScaled();

    const hasSameDissolve = staleDissolve === dissolve;
    this.polygons = hasSameDissolve && hasSamePath ? this.polygons : this.getPolygons();

    const hasSameGeometry = hasSameDissolve && hasSamePath;
    this.geometry = hasSameGeometry ? this.geometry : this.getGeometry();

    this.wasUpdated = !(hasSamePath && hasSameDissolve && hasSameGeometry);
  }

  private getGeometry(): Geometry[] {
    const geometries = [];
    for (const contourUnscaled of this.polygonsUnionedScaled) {
      const contour = contourUnscaled.map(({ x, y }) => ({ x: x / this.scalingFactor, y: y / this.scalingFactor }));

      // TODO performance optimization by doing deltas for all shapes at same time
      const steinerPoints: Array<{ x: number; y: number }> = samplePolygon(contour);

      const vertexMesh: Array<[number, number]> = [];
      try {
        const triangulation = new poly2tri.SweepContext(contour);
        triangulation.addPoints(steinerPoints);
        triangulation.triangulate();
        triangulation.getTriangles().forEach((t) => t.getPoints().forEach(({ x, y }) => vertexMesh.push([x, y])));
      } catch (e: unknown) {
        if (e instanceof poly2tri.PointError) {
          // TODO dont update model from previous run once performance optimization complete
        }
      }

      const geometry = new Geometry().addAttribute("aVertexPosition", vertexMesh.flat(), 2);
      /* debug show mesh lines
        .addAttribute(
          "aGradient",
          triangulation
            .getTriangles()
            .map((tri) => [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ])
            .flat(2)
        ); */
      geometries.push(geometry);
    }
    return geometries;
  }

  private getPolygons(): Array<Array<[number, number]>> {
    const polygonsUnionedScaled =
      this.clipper
        .offsetToPaths({
          delta: -this.scalingFactor * 20 * this.dissolve,
          offsetInputs: this.polygonsUnionedScaled.map((path) => {
            return {
              joinType: clipperLib.JoinType.Square,
              endType: clipperLib.EndType.ClosedPolygon,
              data: path,
            };
          }),
        })
        ?.filter((p) => this.clipper.orientation(p)) ?? [];
    const polygons = polygonsUnionedScaled.map((p) =>
      p.map(({ x, y }) => [x / this.scalingFactor, y / this.scalingFactor] as [number, number])
    );
    const simplePolygon = polygons
      .map((polygon) => polygon.map(([x, y]) => ({ x, y })))
      .map((polygon) => simplify(polygon, 1))
      .map((polygon) => polygon.map(({ x, y }: { x: number; y: number }) => [x, y] as [number, number]));
    return simplePolygon;
  }

  private getPolygonsUnionedScaled(): clipperLib.Path[] {
    const { paths } = metaballsPaths(this.clipper, this.model.painShapes, { ...this.model });

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

    return polygonsUnionedScaled;
  }
}
