import { StationCard, type CardStation } from "./StationCard.js";

export function StationList({
  stations,
  onSelect,
  onHover,
  onHoverEnd,
  className,
}: {
  stations: CardStation[];
  onSelect?: (station: CardStation) => void;
  onHover?: (station: CardStation) => void;
  onHoverEnd?: (station: CardStation) => void;
  className?: string;
}) {
  return (
    <ul
      className={`m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-3 p-0 ${className ?? ""}`}
    >
      {stations.map((station) => (
        <li
          key={`${station.kind}:${station.id}`}
          onMouseEnter={() => onHover?.(station)}
          onMouseLeave={() => onHoverEnd?.(station)}
          onFocus={() => onHover?.(station)}
          onBlur={() => onHoverEnd?.(station)}
        >
          <StationCard station={station} distance={station.distance} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
