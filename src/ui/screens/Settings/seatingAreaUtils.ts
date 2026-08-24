export type SeatingAreaLike = {
  id: string;
  name: string;
  order?: number;
  active?: boolean;
};

export type TableAreaLike = {
  id: number;
  areaId: string;
  seats?: number;
};

export function buildSeatingAreaId(name: string, now = Date.now()) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
  return slug ? `area:${slug}` : `area:${now}`;
}

export function addSeatingAreaDraft(
  areas: SeatingAreaLike[],
  rawName: string,
  now = Date.now(),
): { areas: SeatingAreaLike[]; error?: string } {
  const name = String(rawName || "").trim();
  if (!name) {
    return { areas, error: "Area name is required" };
  }
  const id = buildSeatingAreaId(name, now);
  if (areas.some((area) => area.id === id || area.name.toLowerCase() === name.toLowerCase())) {
    return { areas, error: "Area already exists" };
  }
  return {
    areas: [
      ...areas,
      {
        id,
        name,
        order: areas.length + 1,
        active: true,
      },
    ],
  };
}

export function moveSeatingAreaByDirection(
  areas: SeatingAreaLike[],
  id: string,
  direction: -1 | 1,
): SeatingAreaLike[] {
  const index = areas.findIndex((area) => area.id === id);
  if (index < 0) {
    return areas;
  }
  const target = index + direction;
  if (target < 0 || target >= areas.length) {
    return areas;
  }
  const copy = [...areas];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved);
  return copy.map((area, idx) => ({ ...area, order: idx + 1 }));
}

export function reorderSeatingAreasByDrag(
  areas: SeatingAreaLike[],
  draggedId: string,
  dropTargetId: string,
): SeatingAreaLike[] {
  if (!draggedId || !dropTargetId || draggedId === dropTargetId) {
    return areas;
  }
  const from = areas.findIndex((area) => area.id === draggedId);
  const to = areas.findIndex((area) => area.id === dropTargetId);
  if (from < 0 || to < 0) {
    return areas;
  }
  const copy = [...areas];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy.map((area, idx) => ({ ...area, order: idx + 1 }));
}

export function computeTableAreaUpdates(
  tableDocs: TableAreaLike[],
  tableAreaDraft: Record<number, string>,
  activeAreaIds: Set<string>,
): Array<{ tableId: number; areaId: string }> {
  return Object.entries(tableAreaDraft)
    .filter(([, areaId]) => activeAreaIds.has(areaId))
    .map(([tableId, areaId]) => ({ tableId: Number(tableId), areaId }))
    .filter(({ tableId, areaId }) => {
      const table = tableDocs.find((entry) => entry.id === tableId);
      return Boolean(table) && table!.areaId !== areaId;
    });
}

export function computeTableSeatsUpdates(
  tableDocs: TableAreaLike[],
  tableSeatsDraft: Record<number, number>,
): Array<{ tableId: number; seats: number }> {
  return Object.entries(tableSeatsDraft)
    .map(([tableId, seats]) => ({
      tableId: Number(tableId),
      seats: Math.trunc(Number(seats)),
    }))
    .filter(({ tableId, seats }) => {
      if (!Number.isInteger(tableId) || tableId <= 0) {
        return false;
      }
      if (!Number.isInteger(seats) || seats < 1 || seats > 50) {
        return false;
      }
      const table = tableDocs.find((entry) => entry.id === tableId);
      return Boolean(table) && Number(table!.seats || 0) !== seats;
    });
}
