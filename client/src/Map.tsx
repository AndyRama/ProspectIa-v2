import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Crosshair, Maximize2, Minimize2, Check } from "lucide-react";
import type { Prospect } from "../../server/types";
export default function ProspectMap({
  items,
  onOpen,
  onSelect,
}: {
  items: Prospect[];
  onOpen: (p: Prospect) => void;
  onSelect: (items: Prospect[]) => void;
}) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    group = useRef<L.MarkerClusterGroup | null>(null);
  const [large, setLarge] = useState(false),
    [visible, setVisible] = useState<Prospect[]>([]),
    [tileError, setTileError] = useState(false);
  const refs = useRef({ items, onOpen, onSelect });
  refs.current = { items, onOpen, onSelect };
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([-17.535, -149.566], 13);
    map.current = m;
    const tiles = L.tileLayer("/api/tiles/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(m);
    tiles.on("tileerror", () => setTileError(true));
    group.current = L.markerClusterGroup({
      animate: false,
      showCoverageOnHover: false,
      maxClusterRadius: 38,
    }).addTo(m);
    const update = () =>
      setVisible(
        refs.current.items.filter(
          (p) =>
            p.lat !== null &&
            p.lng !== null &&
            m.getBounds().contains([p.lat, p.lng]),
        ),
      );
    m.on("moveend", update);
    return () => {
      m.stop();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      g = group.current;
    if (!m || !g) return;
    g.clearLayers();
    const located = items.filter((p) => p.lat !== null && p.lng !== null);
    for (const p of located) {
      const color = p.selected
        ? "#14796b"
        : p.status !== "À contacter"
          ? "#7894ac"
          : "#d0a45c";
      const marker = L.marker([p.lat!, p.lng!], {
        icon: L.divIcon({
          className: "prospect-marker",
          html: `<span style="background:${color}"></span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      });
      const box = document.createElement("div");
      box.className = "map-popup";
      const title = document.createElement("strong");
      title.textContent = p.name;
      box.append(title);
      const address = document.createElement("p");
      address.textContent =
        p.address + (p.demo ? " · Démonstration fictive" : "");
      box.append(address);
      if (p.email) {
        const e = document.createElement("p");
        e.textContent = p.email;
        box.append(e);
      }
      for (const [text, fn] of [
        ["Voir la fiche", () => refs.current.onOpen(refs.current.items.find((item) => item.id === p.id) || p)],
        ["Sélectionner cette entreprise", () => refs.current.onSelect([refs.current.items.find((item) => item.id === p.id) || p])],
      ] as const) {
        const button = document.createElement("button");
        button.textContent = text;
        button.onclick = fn;
        box.append(button);
      }
      marker.bindPopup(box);
      g.addLayer(marker);
    }
    if (located.length)
      m.fitBounds(
        L.latLngBounds(
          located.map((p) => [p.lat!, p.lng!] as L.LatLngTuple),
        ).pad(0.25),
        { maxZoom: 14, animate: false },
      );
    setVisible(located.filter((p) => m.getBounds().contains([p.lat!, p.lng!])));
  }, [
    items
      .map((p) => `${p.id}:${p.lat}:${p.lng}:${p.selected}:${p.status}`)
      .join("|"),
  ]);
  useEffect(() => {
    const timer = setTimeout(() => map.current?.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [large]);
  const center = () => {
    const g = group.current;
    if (g?.getLayers().length)
      map.current?.fitBounds(g.getBounds().pad(0.25), {
        maxZoom: 14,
        animate: false,
      });
  };
  return (
    <section className={"card map-card " + (large ? "map-expanded" : "")}>
      <div className="section-top">
        <div>
          <h3>Explorez les entreprises autour de vous</h3>
          <p>
            {items.filter((p) => p.lat !== null && p.lng !== null).length}{" "}
            entreprises localisées ·{" "}
            {items.filter((p) => p.lat === null || p.lng === null).length} sans
            position renseignée
          </p>
        </div>
        <div className="button-group">
          <button className="button ghost" onClick={center}>
            <Crosshair size={15} /> Recentrer
          </button>
          <button className="button ghost" onClick={() => setLarge(!large)}>
            {large ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{" "}
            {large ? "Réduire" : "Agrandir la carte"}
          </button>
        </div>
      </div>
      <div className="map-wrap">
        <div className="leaflet-map" ref={el} />
        {tileError && (
          <div className="map-warning">
            Fond de carte indisponible : vérifiez l’accès à
            tile.openstreetmap.org. Les marqueurs restent consultables.
          </div>
        )}
        <div className="map-legend">
          <span>
            <i className="dot gold" />
            Opportunité
          </span>
          <span>
            <i className="dot teal" />
            Sélectionné
          </span>
          <span>
            <i className="dot blue" />
            Contacté
          </span>
        </div>
      </div>
      <div className="map-footer">
        <span>Une rencontre commence souvent tout près.</span>
        <button
          className="button primary small"
          disabled={!visible.length}
          onClick={() => onSelect(visible)}
        >
          <Check size={14} />
          Sélectionner la zone visible ({visible.length})
        </button>
      </div>
    </section>
  );
}
