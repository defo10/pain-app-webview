import { Geometry, Point } from "pixi.js";
import { ShapeParameters } from "./model";
import * as clipperLib from "js-angusj-clipper";
import { metaballsPaths, samplePolygon } from "./polygon";
import _ from "lodash";
import poly2tri from "poly2tri";
import { polyon2starshape, minimumDistancePointOnLine, MinsDistData, lineLineIntersection } from "./polygon/polygons";
import { Delaunay } from "d3-delaunay";
import { Polygon as EuclidPolygon, Point as EuclidPoint, Line } from "@mathigon/euclid";
import simplify from "simplify-js";
import { find_path } from "dijkstrajs";

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
    for (const contour of this.polygons) {
      const delaunay = Delaunay.from(contour);
      const { points, halfedges, triangles } = delaunay;
      const lines = [];
      for (let i = 0, n = halfedges.length; i < n; ++i) {
        const j = halfedges[i];
        if (j < i) continue;
        const ti = triangles[i];
        const tj = triangles[j];
        lines.push([
          [points[ti * 2], points[ti * 2 + 1]],
          [points[tj * 2], points[tj * 2 + 1]],
        ]);
      }

      const voronoiPoint = () => {
        const polygon = new EuclidPolygon(...contour.map(([x, y]) => new EuclidPoint(x, y)));
        const voronoi = delaunay.voronoi();
        const svgPath = voronoi.render();
        const buffer = [];
        const {
          delaunay: { halfedges, inedges, hull },
          circumcenters,
          vectors,
        } = voronoi;
        if (hull.length <= 1) return null;
        for (let i = 0, n = halfedges.length; i < n; ++i) {
          const j = halfedges[i];
          if (j < i) continue;
          const ti = Math.floor(i / 3) * 2;
          const tj = Math.floor(j / 3) * 2;
          const xi = circumcenters[ti];
          const yi = circumcenters[ti + 1];
          const xj = circumcenters[tj];
          const yj = circumcenters[tj + 1];
          if (polygon.contains(new EuclidPoint(xi, yi)) && polygon.contains(new EuclidPoint(xj, yj))) {
            buffer.push([xi, yi, xj, yj]);
          }
        }
        return buffer;
      };
      const b = voronoiPoint() ?? [];

      // create a graph out of b
      const graph: { [key: string]: { [key: string]: number } } = {};
      for (const [x1, y1, x2, y2] of b) {
        const p1 = `${x1},${y1}`;
        const p2 = `${x2},${y2}`;
        if (!(p1 in graph)) graph[p1] = {};
        if (!(p2 in graph)) graph[p2] = {};
        graph[p1][p2] = 1;
        graph[p2][p1] = 1;
      }

      const mesh: Array<[[number, number], [number, number], [number, number]]> = [];
      const calcMinDistProjections = ([x, y]: [number, number]): MinsDistData[] =>
        b.map(([xi, yi, xj, yj]) => minimumDistancePointOnLine(new Point(xi, yi), new Point(xj, yj), new Point(x, y)));

      let minDistProjections: MinsDistData[] | undefined;
      for (let i = 0; i < contour.length; i++) {
        const p1 = contour[i];
        const p2 = contour[(i + 1) % contour.length];

        if (minDistProjections == null) {
          minDistProjections = calcMinDistProjections(p1);
        }
        // the ?? operator should be superflous here, however, typescript does not recognize that minDistProjections is not null
        const closestProjection = _.minBy(minDistProjections, (p) => p.distance) ?? minDistProjections[0];

        minDistProjections = calcMinDistProjections(p2);
        const nextClosestProjection = _.minBy(minDistProjections, (p) => p.distance) ?? minDistProjections[0];

        if (_.isEqual(closestProjection?.line, nextClosestProjection?.line)) {
          mesh.push([p1, [closestProjection?.projection.x ?? 0, closestProjection?.projection.y ?? 0], p2]);
          mesh.push([
            p2,
            [closestProjection?.projection.x ?? 0, closestProjection?.projection.y ?? 0],
            [nextClosestProjection?.projection.x ?? 0, nextClosestProjection?.projection.y ?? 0],
          ]);
          continue;
        }
        // next line is different -> add triangles that span all lines in-between
        const vFrom = [closestProjection.line[2], closestProjection.line[3]];
        const vTo = [nextClosestProjection.line[0], nextClosestProjection.line[1]];
        const shortestPath = find_path(graph, `${vFrom[0]},${vFrom[1]}`, `${vTo[0]},${vTo[1]}`);

        for (let j = 0; j < shortestPath.length - 1; j++) {
          const pj1: [number, number] = shortestPath[j].split(",").map((v: string) => parseFloat(v));
          const pj2: [number, number] = shortestPath[j + 1].split(",").map((v: string) => parseFloat(v));
          mesh.push([p1, pj1, pj2]);
        }
        mesh.push([[nextClosestProjection.projection.x ?? 0, nextClosestProjection.projection.y ?? 0], p2, p1]);
      }

      const vertexMesh: Array<[number, number]> = mesh.flat();

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
      .map((polygon) => simplify(polygon, 0.2))
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
