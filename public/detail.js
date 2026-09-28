(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const mapElement = document.getElementById("detailMap");

    if (!mapElement || typeof window.maplibregl === "undefined") {
      return;
    }

    const lat = Number.parseFloat(mapElement.dataset.lat);
    const lng = Number.parseFloat(mapElement.dataset.lng);
    const venue = mapElement.dataset.venue || "Event venue";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapElement,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [lng, lat],
      zoom: 14.5,
      attributionControl: true
    });

    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    const markerElement = document.createElement("div");
    markerElement.className = "detail-map-marker";

    new maplibregl.Marker({
      element: markerElement,
      anchor: "bottom"
    })
      .setLngLat([lng, lat])
      .setPopup(
        new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${escapeHTML(venue)}</strong>`
        )
      )
      .addTo(map);

    map.once("load", () => {
      window.setTimeout(() => map.resize(), 100);
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(mapElement);
    }
  });

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
