import _ from "lodash";

export class Entry<T> {
  readonly distance: number;
  readonly ref: T;

  constructor(distance: number, ref: T) {
    this.distance = distance;
    this.ref = ref;
  }
}

type Dist<T> = (a: T, b: T) => number;

/** Map which calculates the distances from each point to another, using [dist] function */
export class DistanceMatrix<T> {
  readonly dist: Dist<T>;

  private readonly points: T[];
  private readonly matrix: Map<T, Entry<T>[]>;

  constructor(points: T[], dist: Dist<T>) {
    this.dist = dist;
    this.points = [...points];

    const keys = this.points;
    const values = points.map((from) =>
      _.sortBy(
        points.filter((p) => p !== from).map((to) => new Entry(dist(from, to), to)),
        (e) => e.distance
      )
    );
    this.matrix = new Map(_.zip(keys, values)) as Map<T, Entry<T>[]>;
  }

  between(from: T, to: T): number | undefined {
    return this.matrix.get(from)?.find((e) => e.ref === to)?.distance;
  }

  knn(from: T, k?: number): Entry<T>[] {
    // create copy before splicing
    return [...this.matrix.get(from)!].splice(0, k ? k + 1 : this.points.length) ?? [];
  }

  nn(from: T) {
    return this.knn(from, 1)[0];
  }

  nnWithin(from: T, smallerEqualThan: number) {
    return _.takeWhile(this.matrix.get(from), (e) => e.distance <= smallerEqualThan);
  }

  where(from: T, predicate: (to: Entry<T>) => Boolean) {
    return this.matrix.get(from)?.filter(predicate);
  }
}
