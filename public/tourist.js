(() => {
  if (document.readyState === "complete") {
    initialiseTouristMap();
  } else {
    window.addEventListener("load", initialiseTouristMap, { once: true });
  }

  function initialiseTouristMap() {
    const mapElement = document.getElementById("touristMap");
    const routeDataElement = document.getElementById("touristRouteData");
    const distanceElement = document.getElementById("touristRouteDistance");
    const durationElement = document.getElementById("touristRouteDuration");
    const noteElement = document.getElementById("touristMapNote");

    if (!mapElement || !routeDataElement) {
      return;
    }

    const showMapMessage = message => {
      mapElement.innerHTML = "";

      const messageElement = document.createElement("p");
      messageElement.textContent = message;
      messageElement.style.margin = "0";
      messageElement.style.padding = "24px";
      messageElement.style.color = "#5f6763";
      messageElement.style.fontSize = "13px";
      messageElement.style.lineHeight = "1.5";

      mapElement.appendChild(messageElement);
    };

    if (typeof window.maplibregl === "undefined") {
      showMapMessage("The map library could not be loaded. Refresh the page and try again.");
      return;
    }

    let stops;

    try {
      stops = JSON.parse(routeDataElement.textContent);
    } catch (error) {
      console.error("Could not read tourist route data:", error);
      showMapMessage("The route data could not be read.");
      return;
    }

    const validStops = Array.isArray(stops)
      ? stops.filter(stop => {
          return (
            stop.coordinates &&
            Number.isFinite(Number(stop.coordinates.lat)) &&
            Number.isFinite(Number(stop.coordinates.lng))
          );
        })
      : [];

    if (validStops.length === 0) {
      showMapMessage("No mapped stops are available for this route.");
      return;
    }

    if (
      typeof window.maplibregl.supported === "function" &&
      !window.maplibregl.supported()
    ) {
      showMapMessage("This browser cannot display the interactive map.");
      return;
    }

    mapElement.innerHTML = "";

    const map = new window.maplibregl.Map({
      container: mapElement,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [
        Number(validStops[0].coordinates.lng),
        Number(validStops[0].coordinates.lat)
      ],
      zoom: 13,
      attributionControl: true
    });

    map.addControl(
      new window.maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    const markerRecords = new Map();
    const stopCards = new Map();

    document.querySelectorAll("[data-tourist-stop-id]").forEach(card => {
      stopCards.set(card.dataset.touristStopId, card);
    });

    validStops.forEach((stop, index) => {
      const coordinates = [
        Number(stop.coordinates.lng),
        Number(stop.coordinates.lat)
      ];

      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = `tourist-map-marker tourist-map-marker-${index + 1}`;
      markerElement.textContent = stop.step;
      markerElement.setAttribute("aria-label", `${stop.step}. ${stop.title}`);

      const popupFacts = [
        stop.categoryLabel,
        stop.visitMinutes ? `${stop.visitMinutes} min` : ""
      ]
        .filter(Boolean)
        .map(value => `<small>${escapeHtml(value)}</small>`)
        .join("");

      const popup = new window.maplibregl.Popup({
        offset: 20,
        closeButton: false
      }).setHTML(`
        <div class="tourist-map-popup">
          <span>${escapeHtml(stop.label)} · ${escapeHtml(stop.step)}</span>
          <strong>${escapeHtml(stop.title)}</strong>
          ${popupFacts ? `<div class="tourist-map-popup-facts">${popupFacts}</div>` : ""}
        </div>
      `);

      const marker = new window.maplibregl.Marker({ element: markerElement })
        .setLngLat(coordinates)
        .setPopup(popup)
        .addTo(map);

      markerRecords.set(String(stop.id), {
        stop,
        marker,
        popup,
        markerElement,
        coordinates
      });

      markerElement.addEventListener("click", () => {
        activateStop(String(stop.id), {
          centreMap: false,
          openPopup: false,
          scrollCard: true
        });
      });
    });

    stopCards.forEach((card, stopId) => {
      card.addEventListener("click", event => {
        if (event.target.closest("a")) {
          return;
        }

        activateStop(stopId, {
          centreMap: true,
          openPopup: true,
          scrollCard: false
        });
      });

      card.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (event.target.closest("a")) {
          return;
        }

        event.preventDefault();

        activateStop(stopId, {
          centreMap: true,
          openPopup: true,
          scrollCard: false
        });
      });
    });

    function activateStop(
      stopId,
      { centreMap = true, openPopup = true, scrollCard = false } = {}
    ) {
      const record = markerRecords.get(String(stopId));
      const card = stopCards.get(String(stopId));

      if (!record) {
        return;
      }

      markerRecords.forEach(item => {
        item.markerElement.classList.remove("is-active");
      });

      stopCards.forEach(item => {
        item.classList.remove("is-active");
      });

      record.markerElement.classList.add("is-active");

      if (card) {
        card.classList.add("is-active");
      }

      if (centreMap) {
        map.easeTo({
          center: record.coordinates,
          zoom: Math.max(map.getZoom(), 15),
          duration: 700
        });
      }

      if (openPopup) {
        markerRecords.forEach(item => {
          if (item.popup.isOpen()) {
            item.popup.remove();
          }
        });

        if (!record.popup.isOpen()) {
          record.marker.togglePopup();
        }
      }

      if (scrollCard && card) {
        card.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      }
    }

    map.once("load", async () => {
      const fallbackGeometry = {
        type: "LineString",
        coordinates: validStops.map(stop => [
          Number(stop.coordinates.lng),
          Number(stop.coordinates.lat)
        ])
      };

      addRouteLayers(map, fallbackGeometry);
      fitMapToCoordinates(map, fallbackGeometry.coordinates, false);
      map.resize();

      try {
        if (noteElement) {
          noteElement.textContent = "Calculating the walking route along Cork streets and footpaths…";
        }

        const points = validStops
          .map(stop => {
            return `${Number(stop.coordinates.lng).toFixed(6)},${Number(
              stop.coordinates.lat
            ).toFixed(6)}`;
          })
          .join(";");

        const params = new URLSearchParams({ points });
        const response = await fetch(`/api/tourist-walking-route?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok || !payload.route?.geometry?.coordinates) {
          throw new Error(payload.message || "Walking route unavailable");
        }

        const routeSource = map.getSource("tourist-route");

        if (routeSource) {
          routeSource.setData({
            type: "Feature",
            properties: {},
            geometry: payload.route.geometry
          });
        }

        map.setPaintProperty("tourist-route-line", "line-dasharray", null);
        map.setPaintProperty("tourist-route-line", "line-opacity", 0.95);
        map.setPaintProperty("tourist-route-casing", "line-opacity", 0.88);

        if (distanceElement) {
          distanceElement.textContent = `${formatDistance(payload.route.distanceKm)} km`;
        }

        const walkingMinutes = Math.max(
          1,
          Math.round(payload.route.durationMinutes)
        );

        if (durationElement) {
          durationElement.textContent = `${walkingMinutes} min walking`;
        }

        const totalDurationElement = document.getElementById("touristTotalDuration");
        const routeMetaElement = document.getElementById("touristRouteMeta");

        if (totalDurationElement && routeMetaElement) {
          const attractionMinutes = Number(routeMetaElement.dataset.attractionMinutes || 0);
          const bufferMinutes = Number(routeMetaElement.dataset.bufferMinutes || 0);
          totalDurationElement.textContent = `${walkingMinutes + attractionMinutes + bufferMinutes} min`;
        }

        if (noteElement) {
          noteElement.textContent =
            "The route follows mapped streets and footpaths. Walking times are estimates.";
        }

        fitMapToCoordinates(map, payload.route.geometry.coordinates, true);
      } catch (error) {
        console.error("Could not load walking directions:", error);

        if (noteElement) {
          noteElement.textContent =
            "Live walking directions are temporarily unavailable, so the map is showing the suggested stop order.";
        }
      }

      activateStop(String(validStops[0].id), {
        centreMap: false,
        openPopup: false,
        scrollCard: false
      });
    });

    map.on("error", event => {
      console.error("Tourist map error:", event?.error || event);
    });

    requestAnimationFrame(() => map.resize());
    window.setTimeout(() => map.resize(), 150);
    window.setTimeout(() => map.resize(), 600);

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapElement);
    } else {
      window.addEventListener("resize", () => map.resize());
    }
  }

  function addRouteLayers(map, geometry) {
    if (map.getSource("tourist-route")) {
      return;
    }

    map.addSource("tourist-route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry
      }
    });

    map.addLayer({
      id: "tourist-route-casing",
      type: "line",
      source: "tourist-route",
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-color": "#fffaf1",
        "line-width": 8,
        "line-opacity": 0
      }
    });

    map.addLayer({
      id: "tourist-route-line",
      type: "line",
      source: "tourist-route",
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-color": "#285f55",
        "line-width": 4.5,
        "line-opacity": 0.82,
        "line-dasharray": [1.5, 1.25]
      }
    });
  }

  function fitMapToCoordinates(map, coordinates, animate) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return;
    }

    const bounds = new window.maplibregl.LngLatBounds();

    coordinates.forEach(coordinate => {
      if (
        Array.isArray(coordinate) &&
        Number.isFinite(Number(coordinate[0])) &&
        Number.isFinite(Number(coordinate[1]))
      ) {
        bounds.extend([Number(coordinate[0]), Number(coordinate[1])]);
      }
    });

    if (bounds.isEmpty()) {
      return;
    }

    map.fitBounds(bounds, {
      padding: {
        top: 74,
        right: 58,
        bottom: 74,
        left: 58
      },
      maxZoom: 14.7,
      duration: animate ? 850 : 0
    });
  }

  function formatDistance(distanceKm) {
    const distance = Number(distanceKm);

    if (!Number.isFinite(distance)) {
      return "—";
    }

    return distance < 10 ? distance.toFixed(1) : Math.round(distance).toString();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
