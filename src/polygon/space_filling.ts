import { Polygon as EuclidPolygon, Point as EuclidPoint, Circle } from "@mathigon/euclid";
import { Point } from "pixi.js";
import { circlePolygon } from "./polygons";

export interface Position {
  center: [number, number];
  radius: number;
}

export class RandomSpaceFilling {
  private readonly contour: EuclidPolygon;
  private readonly minX: number;
  private readonly minY: number;
  private readonly maxX: number;
  private readonly maxY: number;
  private readonly radiusBounds: [number, number];

  constructor(contour: EuclidPolygon, radiusBounds: [number, number]) {
    this.contour = contour;
    const { minX, minY, maxX, maxY } = this.boundingBox(contour);
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
    this.radiusBounds = radiusBounds;
  }

  public getPositions(sampleSizePerUnitSquare: number): Position[] {
    const sampleSize = sampleSizePerUnitSquare * this.contour.area;
    const positions: Position[] = [];
    const circles: Circle[] = [];
    let attempt = 0;
    while (positions.length < sampleSize && attempt < 200) {
      const position = this.randomPosition();
      const circleSamples = circlePolygon(new Point(...position.center), position.radius, Math.PI / 4).map(
        ({ x, y }) => new EuclidPoint(x, y)
      );
      const center = new EuclidPoint(...position.center);

      if (
        this.contour.contains(new EuclidPoint(...position.center)) &&
        circleSamples.every((point) => this.contour.contains(point)) &&
        !circleSamples.some((point) => circles.some((circle) => circle.contains(point)))
      ) {
        positions.push(position);
        circles.push(new Circle(center, position.radius));
      }

      attempt += 1;
    }
    return positions;
  }

  private randomPosition(): Position {
    const randomBetween = (min: number, max: number): number => Math.random() * (max - min) + min;

    const x = randomBetween(this.minX, this.maxX);
    const y = randomBetween(this.minY, this.maxY);
    const radius = randomBetween(...this.radiusBounds);
    return { center: [x, y], radius };
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private boundingBox(contour: EuclidPolygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }
}

class SpaceFilling {
  private readonly gridSize = 10;
  private readonly gridColumns: number;
  private readonly gridRows: number;
  private readonly width: number;
  private readonly height: number;
  // We store a 2D array as a 1D array:
  private dist: number[];
  private readonly contour: EuclidPolygon;

  private boundingBox(contour: EuclidPolygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }

  constructor(contour: EuclidPolygon) {
    const { minX, minY, maxX, maxY } = this.boundingBox(contour);
    this.width = maxX - minX;
    this.height = maxY - minY;
    this.contour = contour;

    this.gridColumns = this.width / this.gridSize;
    this.gridRows = this.height / this.gridSize;

    this.dist = new Array(this.width * this.height);

    let y = this.gridSize / 2;
    for (let row = 0; row < this.gridRows; row++) {
      const distanceFromTop = y;
      const distanceFromBottom = this.height - y;
      for (let col = 0; col < this.gridColumns; col++) {
        const i = row * this.gridColumns + col;
        this.dist[i] = Math.min(distanceFromTop, distanceFromBottom);
      }
      y += this.gridSize;
    }

    let x = this.gridSize / 2;
    for (let col = 0; col < this.gridColumns; col++) {
      const distanceFromLeft = x;
      const distanceFromRight = this.width - x;
      for (let row = 0; row < this.gridRows; row++) {
        const i = row * this.gridColumns + col;
        this.dist[i] = Math.min(this.dist[i], distanceFromLeft, distanceFromRight);
      }
      x += this.gridSize;
    }
  }

  public fillPolygon(circlesRadii: number[]): Position[] {
    const circles: Position[] = circlesRadii.map((radius) => ({
      radius,
      center: [0, 0],
    }));
    for (let circleIndex = 0; circleIndex < circlesRadii.length; circleIndex++) {
      // We assume circles are sorted large to small!
      const radius = circlesRadii[circleIndex];

      // Find gridpoint with largest distance from anything
      let i = 0;
      let maxR = 0;
      let maxC = 0;
      let maxDist = this.dist[0];

      for (let r = 0; r < this.gridRows; r++)
        for (let c = 0; c < this.gridColumns; c++) {
          if (maxDist < this.dist[i]) {
            maxR = r;
            maxC = c;
            maxDist = this.dist[i];
          }
          i++;
        }

      // Calculate position of grid point
      let x = this.gridSize / 2.0 + maxC * this.gridSize;
      let y = this.gridSize / 2.0 + maxR * this.gridSize;

      // Apply some random Jitter
      const offset = (maxDist - radius) / 2.0;
      x += (Math.random() - 0.5) * 2 * offset;
      y += (Math.random() - 0.5) * 2 * offset;

      // drawCircle(x,y,radius);
      circles[circleIndex].center = [x, y];

      // Update Distance array with new circle;
      i = 0;
      let yy = this.gridSize / 2.0;
      for (let r = 0; r < this.gridRows; r++) {
        let xx = this.gridSize / 2.0;
        for (let c = 0; c < this.gridColumns; c++) {
          const d2 = (xx - x) * (xx - x) + (yy - y) * (yy - y);

          // Naive implementation
          // float d = sqrt(d2) - radius;
          // if (dist[i]>d) dist[i] = d;
          // Optimized implementation (no unnecessary sqrt)
          let prev2 = this.dist[i] + radius;
          prev2 *= prev2;
          if (prev2 > d2) {
            const d = Math.sqrt(d2) - radius;
            if (this.dist[i] > d) this.dist[i] = d;
          }

          xx += this.gridSize;
          i++;
        }
        yy += this.gridSize;
      }
    }
    return circles;
  }
}
