(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", initialiseApp);

  function initialiseApp() {
    const mapElement = document.getElementById("map");
    const mapSection = document.querySelector(".map-section");
    const discoverMapCard = document.getElementById("discoverMapCard");
    const mapStickyBody = document.getElementById("mapStickyBody");
    const toggleStickyMapBtn = document.getElementById("toggleStickyMapBtn");
    const MAP_COLLAPSE_STORAGE_KEY = "vibelee:discover-map-collapsed";

    function createFullMapInterface() {
      const mapHeadingActions = document.querySelector(".map-heading-actions");
      const stylesheet = document.createElement("link");
      const openButton = document.createElement("button");
      const overlay = document.createElement("div");

      stylesheet.rel = "stylesheet";
      stylesheet.href = "/full-map.css";
      document.head.appendChild(stylesheet);

      openButton.id = "openFullMapBtn";
      openButton.className = "map-expand-button";
      openButton.type = "button";
      openButton.textContent = "Open full map";
      openButton.setAttribute("aria-haspopup", "dialog");
      openButton.setAttribute("aria-controls", "fullMapOverlay");

      mapHeadingActions?.insertBefore(openButton, toggleStickyMapBtn);

      overlay.id = "fullMapOverlay";
      overlay.className = "full-map-overlay";
      overlay.hidden = true;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "fullMapOverlayTitle");
      overlay.innerHTML = `
        <div class="full-map-dialog">
          <header class="full-map-header">
            <div>
              <p class="section-label">Discover Cork</p>
              <h2 id="fullMapOverlayTitle">Explore the full venue map</h2>
            </div>
            <button
              id="closeFullMapBtn"
              class="full-map-close"
              type="button"
              aria-label="Close full map"
            >
              <span aria-hidden="true">&times;</span>
              <span>Close</span>
            </button>
          </header>
          <div id="fullMapStage" class="full-map-stage"></div>
        </div>
      `;

      document.body.appendChild(overlay);

      return {
        openFullMapBtn: openButton,
        fullMapOverlay: overlay,
        fullMapStage: overlay.querySelector("#fullMapStage"),
        closeFullMapBtn: overlay.querySelector("#closeFullMapBtn")
      };
    }

    const {
      openFullMapBtn,
      fullMapOverlay,
      fullMapStage,
      closeFullMapBtn
    } = createFullMapInterface();
    const embeddedMapParent = mapSection?.parentNode || null;
    const embeddedMapNextSibling = mapSection?.nextSibling || null;
    const modalBackgroundElements = [
      document.querySelector(".app-shell"),
      document.querySelector(".mobile-mode-dock")
    ].filter(Boolean);

    const eventList =
      document.getElementById("eventList") ||
      document.querySelector(".event-list");

    const eventCards = Array.from(
      document.querySelectorAll(".event-card")
    );
    const originalEventCardOrder = [...eventCards];

    const eventPreviewElements = Array.from(
      document.querySelectorAll(".event-preview[data-preview-url]")
    );

    const showAllBtn = document.getElementById("showAllBtn");
    const currentLocationBtn =
      document.getElementById("currentLocationBtn");
    const clearLocationBtn =
      document.getElementById("clearLocationBtn");
    const mapInteractionStatus =
      document.getElementById("mapInteractionStatus");
    const mapLegend = document.getElementById("mapLegend");
    const mapLegendList = document.getElementById("mapLegendList");
    const mobileEventPreview =
      document.getElementById("mobileEventPreview");
    const mobileEventPreviewVenue =
      document.getElementById("mobileEventPreviewVenue");
    const mobileEventPreviewCount =
      document.getElementById("mobileEventPreviewCount");
    const mobileEventPreviewCategory =
      document.getElementById("mobileEventPreviewCategory");
    const mobileEventPreviewTitle =
      document.getElementById("mobileEventPreviewTitle");
    const mobileEventPreviewDate =
      document.getElementById("mobileEventPreviewDate");
    const mobileEventPreviewDetails =
      document.getElementById("mobileEventPreviewDetails");
    const mobileEventPreviewNavigation =
      document.getElementById("mobileEventPreviewNavigation");
    const mobileEventPreviewPosition =
      document.getElementById("mobileEventPreviewPosition");
    const mobileEventPreviewPrevious =
      document.getElementById("mobileEventPreviewPrevious");
    const mobileEventPreviewNext =
      document.getElementById("mobileEventPreviewNext");
    const mobileEventPreviewClose =
      document.getElementById("mobileEventPreviewClose");

    const searchForm = document.querySelector(".search-box");
    const refreshEventsLink =
      document.getElementById("refreshEventsLink");

    const resetFiltersLink =
      document.getElementById("resetFiltersLink");

    const startDateInput =
      document.getElementById("startDateInput");

    const endDateInput =
      document.getElementById("endDateInput");

    const dateRangeSummary =
      document.getElementById("dateRangeSummary");

    const datePresetButtons = Array.from(
      document.querySelectorAll("[data-range-preset]")
    );

    const categoryFilterInput =
      document.getElementById("categoryFilterInput");

    const categoryFilterRail =
      document.getElementById("categoryFilterRail");

    const categoryFilterButtons = Array.from(
      document.querySelectorAll("[data-category-filter]")
    );

    const priceSelect =
      document.querySelector('select[name="price"]');

    const loadingOverlay =
      document.getElementById("loadingOverlay");

    const loadingTitle =
      document.getElementById("loadingTitle");

    const loadingMessage =
      document.getElementById("loadingMessage");

    function showLoading(
      title = "Loading",
      message = "Please wait..."
    ) {
      if (!loadingOverlay) {
        return;
      }

      if (loadingTitle) {
        loadingTitle.textContent = title;
      }

      if (loadingMessage) {
        loadingMessage.textContent = message;
      }

      loadingOverlay.classList.remove("hidden");
    }

    function hideLoading() {
      loadingOverlay?.classList.add("hidden");
    }

    function showMapMessage(message) {
      if (!mapSection) {
        return;
      }

      let status = mapSection.querySelector(".map-status");

      if (!status) {
        status = document.createElement("div");
        status.className = "map-status";
        mapSection.appendChild(status);
      }

      status.textContent = message;
    }

    function clearMapMessage() {
      mapSection
        ?.querySelector(".map-status")
        ?.remove();
    }

    function showMapInteractionStatus(message, isError = false) {
      if (!mapInteractionStatus) {
        return;
      }

      mapInteractionStatus.textContent = message;
      mapInteractionStatus.hidden = !message;
      mapInteractionStatus.classList.toggle("is-error", isError);
    }

    function clearMapInteractionStatus() {
      showMapInteractionStatus("");
    }

    function toLocalIsoDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }

    function addCalendarDays(date, numberOfDays) {
      const result = new Date(date);
      result.setHours(12, 0, 0, 0);
      result.setDate(result.getDate() + numberOfDays);
      return result;
    }

    function formatDateRangeValue(value) {
      if (!value) {
        return "";
      }

      const [year, month, day] = value.split("-").map(Number);

      if (!year || !month || !day) {
        return "";
      }

      return new Intl.DateTimeFormat("en-IE", {
        day: "numeric",
        month: "short",
        year: "numeric"
      }).format(new Date(year, month - 1, day, 12));
    }

    function updateDateRangeSummary() {
      if (!dateRangeSummary) {
        return;
      }

      const startDate = startDateInput?.value || "";
      const endDate = endDateInput?.value || "";

      if (startDate && endDate) {
        dateRangeSummary.textContent =
          startDate === endDate
            ? formatDateRangeValue(startDate)
            : `${formatDateRangeValue(startDate)} to ${formatDateRangeValue(endDate)}`;
      } else if (startDate) {
        dateRangeSummary.textContent = `From ${formatDateRangeValue(startDate)}`;
      } else if (endDate) {
        dateRangeSummary.textContent = `Up to ${formatDateRangeValue(endDate)}`;
      } else {
        dateRangeSummary.textContent = "All upcoming dates";
      }
    }

    function validateDateRange() {
      if (!startDateInput || !endDateInput) {
        return true;
      }

      endDateInput.setCustomValidity("");

      if (
        startDateInput.value &&
        endDateInput.value &&
        endDateInput.value < startDateInput.value
      ) {
        endDateInput.setCustomValidity(
          "The end date must be the same as or later than the start date."
        );
        endDateInput.reportValidity();
        return false;
      }

      return true;
    }

    function updateDatePresetState() {
      const startDate = startDateInput?.value || "";
      const endDate = endDateInput?.value || "";
      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const todayIso = toLocalIsoDate(today);
      const nextThreeEnd = toLocalIsoDate(addCalendarDays(today, 2));
      const dayOfWeek = today.getDay();
      let weekendStartIso = "";
      let weekendEndIso = "";

      if (dayOfWeek === 0) {
        weekendStartIso = todayIso;
        weekendEndIso = todayIso;
      } else {
        const daysUntilSaturday =
          dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
        const weekendStart = addCalendarDays(today, daysUntilSaturday);
        const weekendEnd = addCalendarDays(weekendStart, 1);

        weekendStartIso = toLocalIsoDate(weekendStart);
        weekendEndIso = toLocalIsoDate(weekendEnd);
      }

      datePresetButtons.forEach(button => {
        const preset = button.dataset.rangePreset;
        let isActive = false;

        if (preset === "today") {
          isActive = startDate === todayIso && endDate === todayIso;
        } else if (preset === "next3") {
          isActive = startDate === todayIso && endDate === nextThreeEnd;
        } else if (preset === "weekend") {
          isActive =
            startDate === weekendStartIso && endDate === weekendEndIso;
        } else if (preset === "clear") {
          isActive = !startDate && !endDate;
        }

        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      });
    }

    function setDateRange(startDate, endDate, submitForm = false) {
      if (!startDateInput || !endDateInput) {
        return;
      }

      startDateInput.value = startDate;
      endDateInput.value = endDate;
      endDateInput.min = startDate || "";

      updateDateRangeSummary();
      updateDatePresetState();

      if (submitForm && searchForm) {
        showLoading(
          "Updating events",
          "Filtering Cork events across your selected dates..."
        );
        searchForm.requestSubmit();
      }
    }

    function getSelectedCategoryFilters() {
      return (categoryFilterInput?.value || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
    }

    function setSelectedCategoryFilters(categories) {
      if (!categoryFilterInput) {
        return;
      }

      categoryFilterInput.value = [...new Set(categories)].join(",");
      updateCategoryFilterButtons();
    }

    function updateCategoryFilterButtons() {
      const selectedCategories = new Set(getSelectedCategoryFilters());
      const allSelected = selectedCategories.size === 0;

      categoryFilterButtons.forEach(button => {
        const category = button.dataset.categoryFilter;
        const isSelected =
          category === "all"
            ? allSelected
            : selectedCategories.has(category);

        button.classList.toggle("active", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      });
    }

    function submitCategoryFilters() {
      if (!searchForm) {
        return;
      }

      showLoading(
        "Updating interests",
        "Curating the event list and rebuilding the venue map..."
      );

      searchForm.requestSubmit();
    }

    function initialiseCategoryFilters() {
      if (!categoryFilterInput || categoryFilterButtons.length === 0) {
        return;
      }

      updateCategoryFilterButtons();

      categoryFilterButtons.forEach(button => {
        button.addEventListener("click", () => {
          const category = button.dataset.categoryFilter;
          const selectedCategories = new Set(getSelectedCategoryFilters());

          if (category === "all") {
            selectedCategories.clear();
          } else if (selectedCategories.has(category)) {
            selectedCategories.delete(category);
          } else {
            selectedCategories.add(category);
          }

          setSelectedCategoryFilters([...selectedCategories]);
          submitCategoryFilters();
        });
      });

      const firstActiveButton = categoryFilterButtons.find(button => {
        return button.classList.contains("active") &&
          button.dataset.categoryFilter !== "all";
      });

      if (firstActiveButton && categoryFilterRail) {
        window.setTimeout(() => {
          const targetLeft =
            firstActiveButton.offsetLeft -
            (categoryFilterRail.clientWidth - firstActiveButton.offsetWidth) / 2;

          categoryFilterRail.scrollTo({
            left: Math.max(0, targetLeft),
            behavior: "auto"
          });
        }, 0);
      }
    }

    initialiseCategoryFilters();

    function initialiseEventPreviewImages() {
      if (eventPreviewElements.length === 0) {
        return;
      }

      const queue = [];
      const queuedElements = new Set();
      const maximumConcurrentLoads = 3;
      let activeLoads = 0;

      function setPreviewUnavailable(previewElement) {
        previewElement.dataset.previewState = "unavailable";
        previewElement.classList.remove("is-loading");
        previewElement.classList.add("is-unavailable");

        const status = previewElement.querySelector(
          ".event-preview-status"
        );

        if (status) {
          status.textContent = "No event image available";
        }
      }

      function revealPreviewImage(previewElement, imageUrl, source) {
        return new Promise((resolve, reject) => {
          const imageElement = previewElement.querySelector(
            ".event-preview-image"
          );

          if (!imageElement || !imageUrl) {
            reject(new Error("No image URL was returned"));
            return;
          }

          const preloader = new Image();
          preloader.decoding = "async";

          preloader.addEventListener(
            "load",
            () => {
              imageElement.src = imageUrl;
              previewElement.dataset.previewState = "loaded";
              previewElement.dataset.previewSource = source || "event-page";
              previewElement.classList.remove(
                "is-loading",
                "is-unavailable"
              );
              previewElement.classList.add("is-loaded");

              const status = previewElement.querySelector(
                ".event-preview-status"
              );

              if (status) {
                status.textContent = "";
              }

              resolve();
            },
            { once: true }
          );

          preloader.addEventListener(
            "error",
            () => reject(new Error("The event image could not be loaded")),
            { once: true }
          );

          preloader.src = imageUrl;
        });
      }

      async function loadPreview(previewElement) {
        if (
          !previewElement ||
          ["loading", "loaded", "unavailable"].includes(
            previewElement.dataset.previewState
          )
        ) {
          return;
        }

        const previewUrl = previewElement.dataset.previewUrl;

        if (!previewUrl) {
          setPreviewUnavailable(previewElement);
          return;
        }

        previewElement.dataset.previewState = "loading";
        previewElement.classList.add("is-loading");

        try {
          const response = await fetch(previewUrl, {
            headers: {
              Accept: "application/json"
            }
          });

          if (!response.ok) {
            throw new Error(`Preview request failed with ${response.status}`);
          }

          const preview = await response.json();

          if (!preview.imageUrl) {
            setPreviewUnavailable(previewElement);
            return;
          }

          await revealPreviewImage(
            previewElement,
            preview.imageUrl,
            preview.imageSource
          );
        } catch (error) {
          console.warn("Could not load event preview image:", error.message);
          setPreviewUnavailable(previewElement);
        }
      }

      function processQueue() {
        while (
          activeLoads < maximumConcurrentLoads &&
          queue.length > 0
        ) {
          const previewElement = queue.shift();
          queuedElements.delete(previewElement);
          activeLoads += 1;

          loadPreview(previewElement).finally(() => {
            activeLoads -= 1;
            processQueue();
          });
        }
      }

      function queuePreview(previewElement) {
        if (
          !previewElement ||
          queuedElements.has(previewElement) ||
          ["loading", "loaded", "unavailable"].includes(
            previewElement.dataset.previewState
          )
        ) {
          return;
        }

        queuedElements.add(previewElement);
        queue.push(previewElement);
        processQueue();
      }

      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          entries => {
            entries.forEach(entry => {
              if (!entry.isIntersecting) {
                return;
              }

              observer.unobserve(entry.target);
              queuePreview(entry.target);
            });
          },
          {
            rootMargin: "500px 0px",
            threshold: 0.01
          }
        );

        eventPreviewElements.forEach(element => observer.observe(element));
      } else {
        eventPreviewElements.slice(0, 8).forEach(queuePreview);
      }
    }

    initialiseEventPreviewImages();

    if (!mapElement) {
      console.error("Map container #map was not found.");
      return;
    }

    if (typeof window.maplibregl === "undefined") {
      showMapMessage(
        "MapLibre did not load. Check the MapLibre script in index.ejs."
      );

      console.error("MapLibre failed to load.");
      return;
    }

    if (
      typeof maplibregl.supported === "function" &&
      !maplibregl.supported()
    ) {
      showMapMessage(
        "This browser does not support the WebGL features required by the map."
      );

      return;
    }

    const map = new maplibregl.Map({
      container: mapElement,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-8.4756, 51.8985],
      zoom: 10.5,
      attributionControl: false
    });

    map.addControl(
      new maplibregl.NavigationControl(),
      "bottom-right"
    );

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left"
    );

    let fullMapOpen = false;

    function fullMapIsOpen() {
      return fullMapOpen;
    }

    function resizeMapAfterLayoutChange() {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          map.resize();
        });
      });
    }

    function setModalBackgroundInert(inert) {
      modalBackgroundElements.forEach(element => {
        element.inert = inert;
      });
    }

    function openFullMap(event) {
      event?.preventDefault();

      if (fullMapOpen || !mapSection || !fullMapStage) {
        return;
      }

      fullMapOpen = true;
      fullMapOverlay.hidden = false;
      openFullMapBtn.setAttribute("aria-expanded", "true");
      document.body.classList.add("full-map-open");
      setModalBackgroundInert(true);
      fullMapStage.appendChild(mapSection);
      closeFullMapBtn?.focus();
      resizeMapAfterLayoutChange();
    }

    function closeFullMap(event) {
      event?.preventDefault();

      if (!fullMapOpen || !mapSection || !embeddedMapParent) {
        return;
      }

      if (embeddedMapNextSibling?.parentNode === embeddedMapParent) {
        embeddedMapParent.insertBefore(mapSection, embeddedMapNextSibling);
      } else {
        embeddedMapParent.appendChild(mapSection);
      }

      fullMapOpen = false;
      fullMapOverlay.hidden = true;
      openFullMapBtn.setAttribute("aria-expanded", "false");
      document.body.classList.remove("full-map-open");
      setModalBackgroundInert(false);
      resizeMapAfterLayoutChange();

      openFullMapBtn.focus();
    }

    openFullMapBtn.setAttribute("aria-expanded", "false");
    openFullMapBtn.addEventListener("click", openFullMap);
    closeFullMapBtn?.addEventListener("click", closeFullMap);

    fullMapOverlay.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeFullMap(event);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        fullMapOverlay.querySelectorAll(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter(element => !element.hidden && element.offsetParent !== null);

      if (focusableElements.length === 0) {
        event.preventDefault();
        closeFullMapBtn?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    });

    function mapIsCollapsed() {
      return discoverMapCard?.classList.contains("is-collapsed") || false;
    }

    function updateMapToggleButton(collapsed) {
      if (!toggleStickyMapBtn) {
        return;
      }

      toggleStickyMapBtn.textContent = collapsed ? "Show map" : "Hide map";
      toggleStickyMapBtn.setAttribute("aria-expanded", String(!collapsed));
    }

    function setMapCollapsed(collapsed, persist = true) {
      if (!discoverMapCard || !mapStickyBody) {
        return;
      }

      discoverMapCard.classList.toggle("is-collapsed", collapsed);
      mapStickyBody.setAttribute("aria-hidden", String(collapsed));
      updateMapToggleButton(collapsed);

      if (collapsed) {
        hideEventPreview();
      }

      if (persist) {
        try {
          window.localStorage.setItem(
            MAP_COLLAPSE_STORAGE_KEY,
            collapsed ? "true" : "false"
          );
        } catch {
          // The map remains usable when storage is unavailable.
        }
      }

      if (!collapsed) {
        window.setTimeout(() => {
          map.resize();
        }, 120);
      }
    }

    function restoreMapPreference() {
      let shouldCollapse = false;

      try {
        shouldCollapse =
          window.localStorage.getItem(MAP_COLLAPSE_STORAGE_KEY) === "true";
      } catch {
        shouldCollapse = false;
      }

      setMapCollapsed(shouldCollapse, false);
    }

    function updateStickyMapState() {
      if (!discoverMapCard) {
        return;
      }

      const isStuck =
        !mapIsCollapsed() &&
        discoverMapCard.getBoundingClientRect().top <= 1 &&
        window.scrollY > 20;

      discoverMapCard.classList.toggle("is-stuck", isStuck);
    }

    restoreMapPreference();

    toggleStickyMapBtn?.addEventListener("click", event => {
      event.preventDefault();
      setMapCollapsed(!mapIsCollapsed());
      updateStickyMapState();
    });

    window.addEventListener("scroll", updateStickyMapState, {
      passive: true
    });

    const venueGroups = new Map();
    const markers = [];

    const bounds =
      new maplibregl.LngLatBounds();

    let selectedGroup = null;
    let selectedCard = null;
    let previewedGroup = null;
    let pointerPreviewGroup = null;
    let focusPreviewGroup = null;
    let userMarker = null;
    let mapReady = false;

    function escapeHTML(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function calculateDistanceKm(
      lat1,
      lng1,
      lat2,
      lng2
    ) {
      const earthRadiusKm = 6371;

      const toRadians = value =>
        (value * Math.PI) / 180;

      const dLat = toRadians(lat2 - lat1);
      const dLng = toRadians(lng2 - lng1);

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
          Math.cos(toRadians(lat2)) *
          Math.sin(dLng / 2) ** 2;

      return (
        earthRadiusKm *
        2 *
        Math.atan2(
          Math.sqrt(a),
          Math.sqrt(1 - a)
        )
      );
    }

    function formatDistance(distanceKm) {
      if (distanceKm < 1) {
        return `${Math.round(
          distanceKm * 1000
        )} m away`;
      }

      return `${distanceKm.toFixed(1)} km away`;
    }

    function clearActiveCards() {
      eventCards.forEach(card => {
        card.classList.remove("active");
        card.removeAttribute("aria-current");
      });
    }

    function scrollCardBelowStickyMap(card) {
      if (!card) {
        return;
      }

      const stickyOffset =
        discoverMapCard && !mapIsCollapsed()
          ? discoverMapCard.getBoundingClientRect().height + 14
          : 18;

      const targetTop =
        card.getBoundingClientRect().top +
        window.scrollY -
        stickyOffset;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    }

    function selectVenueGroup(group) {
      if (selectedGroup?.markerElement) {
        selectedGroup.markerElement.classList.remove(
          "selected"
        );
        selectedGroup.markerElement.setAttribute("aria-pressed", "false");
      }

      selectedGroup = group || null;

      selectedGroup?.markerElement?.classList.add(
        "selected"
      );
      selectedGroup?.markerElement?.setAttribute("aria-pressed", "true");
    }

    function previewVenueGroup(group) {
      if (previewedGroup === group) {
        return;
      }

      previewedGroup?.markerElement?.classList.remove("previewed");
      previewedGroup = group || null;
      previewedGroup?.markerElement?.classList.add("previewed");
    }

    function syncPreviewVenueGroup() {
      previewVenueGroup(pointerPreviewGroup || focusPreviewGroup);
    }

    function mapIsVisible() {
      const rect = mapElement.getBoundingClientRect();

      return rect.bottom > 0 && rect.top < window.innerHeight;
    }

    function revealMapOnMobileIfNeeded() {
      const usesMobileMapInteraction = window.matchMedia(
        "(max-width: 699px), (pointer: coarse)"
      ).matches;

      if (!usesMobileMapInteraction || mapIsVisible()) {
        return;
      }

      discoverMapCard?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    function getCardData(card) {
      const detailLink =
        card.dataset.detailUrl ||
        card.querySelector(".details-link")?.href ||
        "#";

      return {
        title:
          card
            .querySelector("h3, h2")
            ?.textContent.trim() ||
          "Untitled event",

        venue:
          card.dataset.venue ||
          "Venue not listed",

        date:
          card
            .querySelector(".event-date")
            ?.textContent.trim() || "",

        time:
          card
            .querySelector(".event-time")
            ?.textContent.trim() || "",

        detailLink,

        distanceText:
          card.dataset.distanceText || "",

        category:
          card.dataset.primaryCategory || "music",

        categoryLabel:
          card.dataset.categoryLabel || "Music"
      };
    }

    function hideEventPreview() {
      if (!mobileEventPreview) {
        return;
      }

      mobileEventPreview.hidden = true;
      mapSection?.classList.remove("has-event-preview");
    }

    function renderEventPreview(group, card) {
      if (!mobileEventPreview || !group || !card) {
        hideEventPreview();
        return;
      }

      const event = getCardData(card);
      const eventIndex = group.cards.indexOf(card);
      const eventCount = group.cards.length;
      const position = eventIndex >= 0 ? eventIndex : 0;
      const dateAndTime = [event.date, event.time].filter(Boolean).join(" · ");

      mobileEventPreviewVenue.textContent = group.venue;
      mobileEventPreviewCount.textContent =
        eventCount === 1 ? "1 event" : `${eventCount} events`;
      mobileEventPreviewCategory.textContent = event.categoryLabel;
      mobileEventPreviewCategory.className =
        `mobile-event-preview-category category-${event.category}`;
      mobileEventPreviewTitle.textContent = event.title;
      mobileEventPreviewDate.textContent = dateAndTime;
      mobileEventPreviewDetails.href = event.detailLink;
      mobileEventPreviewDetails.setAttribute(
        "aria-label",
        `View details for ${event.title}`
      );

      const hasMultipleEvents = eventCount > 1;
      mobileEventPreviewNavigation.hidden = !hasMultipleEvents;
      mobileEventPreviewPosition.textContent =
        `${position + 1} of ${eventCount}`;
      mobileEventPreviewPrevious.disabled = position === 0;
      mobileEventPreviewNext.disabled = position === eventCount - 1;
      mobileEventPreviewPrevious.setAttribute(
        "aria-label",
        position > 0
          ? `Show previous event, ${getCardData(group.cards[position - 1]).title}`
          : "No previous event at this venue"
      );
      mobileEventPreviewNext.setAttribute(
        "aria-label",
        position < eventCount - 1
          ? `Show next event, ${getCardData(group.cards[position + 1]).title}`
          : "No next event at this venue"
      );

      mobileEventPreview.hidden = false;
      mapSection?.classList.add("has-event-preview");
    }

    function selectVenueEvent(group, card, { scroll = false } = {}) {
      if (!group || !card) {
        return;
      }

      clearActiveCards();
      selectVenueGroup(group);
      selectedCard = card;
      selectedCard.classList.add("active");
      selectedCard.setAttribute("aria-current", "true");
      renderEventPreview(group, selectedCard);

      if (scroll && !fullMapIsOpen()) {
        scrollCardBelowStickyMap(selectedCard);
      }
    }

    function clearSelectedVenue() {
      clearActiveCards();
      selectedCard = null;
      selectVenueGroup(null);
      hideEventPreview();
    }

    function moveSelectedVenueEvent(offset) {
      if (!selectedGroup || !selectedCard) {
        return;
      }

      const currentIndex = selectedGroup.cards.indexOf(selectedCard);
      const nextIndex = currentIndex + offset;
      const nextCard = selectedGroup.cards[nextIndex];

      if (!nextCard) {
        return;
      }

      selectVenueEvent(selectedGroup, nextCard, { scroll: true });
    }

    function renderMapLegend(groups) {
      if (!mapLegend || !mapLegendList) {
        return;
      }

      const presentCategories = new Map();

      groups.forEach(group => {
        if (!presentCategories.has(group.primaryCategory)) {
          presentCategories.set(group.primaryCategory, group.categoryLabel);
        }
      });

      mapLegendList.replaceChildren();

      presentCategories.forEach((label, category) => {
        const item = document.createElement("li");
        item.className = `map-legend-item category-${category}`;

        const swatch = document.createElement("span");
        swatch.className = "map-legend-swatch";
        swatch.setAttribute("aria-hidden", "true");

        const text = document.createElement("span");
        text.textContent = label;

        item.append(swatch, text);
        mapLegendList.appendChild(item);
      });

      mapLegend.hidden = presentCategories.size === 0;
    }

    function createVenuePopupHTML(group) {
      const eventCount = group.cards.length;

      const cardsHTML = group.cards
        .slice(0, 8)
        .map(card => {
          const event = getCardData(card);

          return `
            <article class="popup-event-card">
              <div class="popup-event-date">
                ${escapeHTML(event.date)}
              </div>

              <div class="popup-event-title">
                <span class="popup-event-category category-${escapeHTML(event.category)}">
                  ${escapeHTML(event.categoryLabel)}
                </span>
                <strong>${escapeHTML(event.title)}</strong>
              </div>

              ${
                event.distanceText
                  ? `
                    <div class="popup-distance">
                      ${escapeHTML(
                        event.distanceText
                      )}
                    </div>
                  `
                  : ""
              }

              <a
                class="popup-event-link"
                href="${escapeHTML(
                  event.detailLink
                )}"
              >
                View event details
              </a>
            </article>
          `;
        })
        .join("");

      const extra =
        eventCount > 8
          ? `
            <p class="popup-extra">
              + ${eventCount - 8}
              more event(s) in the list below
            </p>
          `
          : "";

      const distance = group.distanceText
        ? `
          <p class="popup-distance-main">
            ${escapeHTML(group.distanceText)}
          </p>
        `
        : "";

      return `
        <div class="venue-popup">
          <div class="popup-header">
            <div>
              <div class="popup-label">
                Venue
              </div>

              <h3>
                ${escapeHTML(group.venue)}
              </h3>
            </div>

            <span class="popup-count">
              ${eventCount}
            </span>
          </div>

          <p class="popup-subtitle">
            ${
              eventCount === 1
                ? "1 event"
                : `${eventCount} events`
            }
            at this venue
          </p>

          ${distance}

          <div class="popup-event-list">
            ${cardsHTML}
          </div>

          ${extra}
        </div>
      `;
    }

    function createMarkerElement(group) {
      const element =
        document.createElement("button");

      element.type = "button";
      element.className =
        `venue-marker category-${group.primaryCategory || "music"}`;

      element.title =
        `${group.venue}: ` +
        `${group.cards.length} event(s) · ` +
        `${group.categoryLabel || "Music"}`;

      element.setAttribute(
        "aria-label",
        element.title
      );
      element.setAttribute("aria-pressed", "false");
      element.setAttribute("aria-controls", "mobileEventPreview");

      element.innerHTML = `
        <span class="venue-marker-pin">
          <span>${group.cards.length}</span>
        </span>
      `;

      return element;
    }

    function spreadOverlappingVenueMarkers(groups) {
      const buckets = new Map();

      groups.forEach(group => {
        const key =
          `${group.lat.toFixed(5)},` +
          `${group.lng.toFixed(5)}`;

        if (!buckets.has(key)) {
          buckets.set(key, []);
        }

        buckets.get(key).push(group);
      });

      buckets.forEach(bucket => {
        if (bucket.length === 1) {
          bucket[0].displayLat =
            bucket[0].lat;

          bucket[0].displayLng =
            bucket[0].lng;

          return;
        }

        bucket.forEach((group, index) => {
          const angle =
            (2 * Math.PI * index) /
            bucket.length;

          const radius = 0.00018;

          group.displayLat =
            group.lat +
            Math.sin(angle) * radius;

          group.displayLng =
            group.lng +
            Math.cos(angle) * radius;
        });
      });
    }

    function closeAllPopups() {
      venueGroups.forEach(group => {
        if (group.popup?.isOpen()) {
          group.popup.remove();
        }
      });
    }

    function protectPopupLinkInteractions(popup) {
      const popupElement = popup?.getElement?.();

      if (!popupElement || popupElement.dataset.linksProtected === "true") {
        return;
      }

      const stopLinkEventFromReachingMap = event => {
        if (event.target.closest(".popup-event-link")) {
          event.stopPropagation();
        }
      };

      popupElement.addEventListener(
        "pointerdown",
        stopLinkEventFromReachingMap
      );
      popupElement.addEventListener("click", stopLinkEventFromReachingMap);
      popupElement.dataset.linksProtected = "true";
    }

    function openGroupPopup(group) {
      if (!group?.popup) {
        return;
      }

      closeAllPopups();

      group.popup
        .setLngLat([
          group.displayLng,
          group.displayLat
        ])
        .setHTML(
          createVenuePopupHTML(group)
        )
        .addTo(map);

      protectPopupLinkInteractions(group.popup);
    }

    function updateCardDistance(
      card,
      distanceText
    ) {
      card.dataset.distanceText =
        distanceText;

      let badge =
        card.querySelector(".distance-badge");

      if (!badge) {
        badge = document.createElement("p");
        badge.className = "distance-badge";

        const actions =
          card.querySelector(".card-actions");

        if (actions) {
          actions.before(badge);
        } else {
          card.appendChild(badge);
        }
      }

      badge.textContent = distanceText;
    }

    function sortCardsByDistance() {
      if (!eventList) {
        return;
      }

      [...eventCards]
        .sort((a, b) => {
          const aDistance =
            Number.parseFloat(
              a.dataset.distanceKm
            );

          const bDistance =
            Number.parseFloat(
              b.dataset.distanceKm
            );

          if (!Number.isFinite(aDistance)) {
            return 1;
          }

          if (!Number.isFinite(bDistance)) {
            return -1;
          }

          return aDistance - bDistance;
        })
        .forEach(card => {
          eventList.appendChild(card);
        });
    }

    function restoreOriginalCardOrder() {
      if (!eventList) {
        return;
      }

      originalEventCardOrder.forEach(card => {
        eventList.appendChild(card);
      });
    }

    function clearUserLocation() {
      userMarker?.remove();
      userMarker = null;

      venueGroups.forEach(group => {
        group.distanceKm = null;
        group.distanceText = "";

        group.cards.forEach(card => {
          delete card.dataset.distanceKm;
          delete card.dataset.distanceText;
          card.querySelector(".distance-badge")?.remove();
        });

        group.popup?.setHTML(createVenuePopupHTML(group));
      });

      restoreOriginalCardOrder();
      clearLocationBtn?.setAttribute("hidden", "");
      showMapInteractionStatus(
        "Location cleared. The original event order has been restored."
      );
    }

    function updateDistancesFromUser(
      lat,
      lng
    ) {
      venueGroups.forEach(group => {
        const distanceKm =
          calculateDistanceKm(
            lat,
            lng,
            group.lat,
            group.lng
          );

        const distanceText =
          formatDistance(distanceKm);

        group.distanceKm = distanceKm;
        group.distanceText = distanceText;

        group.cards.forEach(card => {
          card.dataset.distanceKm =
            String(distanceKm);

          updateCardDistance(
            card,
            distanceText
          );
        });

        group.popup?.setHTML(
          createVenuePopupHTML(group)
        );
      });

      sortCardsByDistance();
    }

    eventCards.forEach(card => {
      const lat =
        Number.parseFloat(
          card.dataset.lat
        );

      const lng =
        Number.parseFloat(
          card.dataset.lng
        );

      const venue =
        card.dataset.venue?.trim() ||
        "Venue not listed";

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return;
      }

      const venueKey =
        venue.toLowerCase();

      if (!venueGroups.has(venueKey)) {
        venueGroups.set(venueKey, {
          venue,
          lat,
          lng,
          displayLat: lat,
          displayLng: lng,
          cards: [],
          distanceKm: null,
          distanceText: "",
          marker: null,
          markerElement: null,
          popup: null,
          categoryCounts: new Map(),
          primaryCategory: "music",
          categoryLabel: "Music"
        });
      }

      const group =
        venueGroups.get(venueKey);

      group.cards.push(card);

      const category = card.dataset.primaryCategory || "music";
      group.categoryCounts.set(
        category,
        (group.categoryCounts.get(category) || 0) + 1
      );

      card.venueGroup = group;
    });

    const groups =
      Array.from(venueGroups.values());

    groups.forEach(group => {
      const rankedCategories = [...group.categoryCounts.entries()].sort(
        (first, second) => second[1] - first[1]
      );

      group.primaryCategory = rankedCategories[0]?.[0] || "music";
      group.categoryLabel =
        group.cards.find(card => {
          return card.dataset.primaryCategory === group.primaryCategory;
        })?.dataset.categoryLabel || "Music";
    });

    renderMapLegend(groups);

    spreadOverlappingVenueMarkers(groups);

    groups.forEach(group => {
      const markerElement =
        createMarkerElement(group);

      const popup =
        new maplibregl.Popup({
          offset: 30,
          maxWidth: "340px",
          closeButton: true,
          closeOnClick: false
        }).setHTML(
          createVenuePopupHTML(group)
        );

      const marker =
        new maplibregl.Marker({
          element: markerElement,
          anchor: "bottom"
        })
          .setLngLat([
            group.displayLng,
            group.displayLat
          ])
          .addTo(map);

      group.marker = marker;
      group.markerElement =
        markerElement;

      group.popup = popup;

      markers.push(marker);

      bounds.extend([
        group.displayLng,
        group.displayLat
      ]);

      markerElement.addEventListener(
        "click",
        event => {
          event.preventDefault();

          const firstCard =
            group.cards[0];

          if (firstCard) {
            selectVenueEvent(group, firstCard, { scroll: true });
            openGroupPopup(group);
          }
        }
      );
    });

    eventCards.forEach(card => {
      const focusButton =
        card.querySelector(
          ".map-focus-btn"
        );

      const activateCard = () => {
        const group = card.venueGroup;

        if (!group?.marker) {
          alert(
            "Map location is not available for this venue yet."
          );

          return;
        }

        selectVenueEvent(group, card);

        const focusSelectedVenue = () => {
          map.resize();
          revealMapOnMobileIfNeeded();

          map.flyTo({
            center: [
              group.displayLng,
              group.displayLat
            ],
            zoom: 15,
            speed: 1.2,
            essential: true
          });

          openGroupPopup(group);
        };

        if (mapIsCollapsed()) {
          setMapCollapsed(false);
          window.setTimeout(focusSelectedVenue, 150);
        } else {
          focusSelectedVenue();
        }
      };

      focusButton?.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();
          activateCard();
        }
      );

      card.addEventListener(
        "click",
        event => {
          if (
            event.target.closest(
              "a, button"
            )
          ) {
            return;
          }

          const detailUrl = card.dataset.detailUrl;

          if (detailUrl) {
            window.location.href = detailUrl;
          }
        }
      );

      card.addEventListener("pointerenter", event => {
        if (
          event.pointerType === "touch" ||
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        ) {
          return;
        }

        pointerPreviewGroup = card.venueGroup || null;
        syncPreviewVenueGroup();
      });

      card.addEventListener("pointerleave", () => {
        if (pointerPreviewGroup === card.venueGroup) {
          pointerPreviewGroup = null;
          syncPreviewVenueGroup();
        }
      });

      card.addEventListener("focusin", () => {
        focusPreviewGroup = card.venueGroup || null;
        syncPreviewVenueGroup();
      });

      card.addEventListener("focusout", event => {
        if (card.contains(event.relatedTarget)) {
          return;
        }

        if (focusPreviewGroup === card.venueGroup) {
          focusPreviewGroup = null;
          syncPreviewVenueGroup();
        }
      });
    });

    function resizeMap() {
      window.requestAnimationFrame(() => {
        map.resize();
      });
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined" &&
      mapSection
        ? new ResizeObserver(resizeMap)
        : null;

    resizeObserver?.observe(mapSection);

    window.addEventListener(
      "resize",
      () => {
        resizeMap();
        updateStickyMapState();
      }
    );

    window.addEventListener(
      "orientationchange",
      () => {
        setTimeout(() => {
          resizeMap();
          updateStickyMapState();
        }, 150);
      }
    );

    const loadTimeout =
      window.setTimeout(() => {
        if (!mapReady) {
          showMapMessage(
            "The map is taking longer than expected to load. Try refreshing the page."
          );
        }
      }, 10000);

    map.once("load", () => {
      mapReady = true;

      window.clearTimeout(loadTimeout);
      clearMapMessage();
      resizeMap();

      window.setTimeout(() => {
        map.resize();

        if (
          markers.length > 1 &&
          !bounds.isEmpty()
        ) {
          map.fitBounds(bounds, {
            padding: 42,
            maxZoom: 12.5,
            duration: 0
          });
        } else {
          map.jumpTo({
            center: [-8.4756, 51.8985],
            zoom: 11
          });
        }
      }, 250);
    });

    map.on("error", event => {
      console.error(
        "MapLibre error:",
        event.error || event
      );
    });

    showAllBtn?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        clearSelectedVenue();
        closeAllPopups();

        if (
          markers.length > 1 &&
          !bounds.isEmpty()
        ) {
          map.fitBounds(bounds, {
            padding: 42,
            maxZoom: 12.5
          });
        } else {
          map.flyTo({
            center: [-8.4756, 51.8985],
            zoom: 11
          });
        }
      }
    );

    mobileEventPreviewPrevious?.addEventListener("click", event => {
      event.preventDefault();
      moveSelectedVenueEvent(-1);
    });

    mobileEventPreviewNext?.addEventListener("click", event => {
      event.preventDefault();
      moveSelectedVenueEvent(1);
    });

    mobileEventPreviewClose?.addEventListener("click", event => {
      event.preventDefault();
      hideEventPreview();
    });

    currentLocationBtn?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        clearMapInteractionStatus();
        showLoading(
          "Finding your location",
          "Checking your position and sorting nearby venues..."
        );

        if (!navigator.geolocation) {
          hideLoading();
          showMapInteractionStatus(
            "Geolocation is not supported by this browser.",
            true
          );

          return;
        }

        navigator.geolocation.getCurrentPosition(
          position => {
            const lat =
              position.coords.latitude;

            const lng =
              position.coords.longitude;

            userMarker?.remove();

            const element =
              document.createElement("div");

            element.className =
              "user-location-marker";

            userMarker =
              new maplibregl.Marker({
                element,
                anchor: "center"
              })
                .setLngLat([lng, lat])
                .setPopup(
                  new maplibregl.Popup().setHTML(
                    "<strong>Your current location</strong>"
                  )
                )
                .addTo(map);

            updateDistancesFromUser(
              lat,
              lng
            );

            clearLocationBtn?.removeAttribute("hidden");
            showMapInteractionStatus(
              "Events are sorted by straight-line distance from your current location."
            );

            map.flyTo({
              center: [lng, lat],
              zoom: 13.5,
              essential: true
            });

            hideLoading();
          },
          error => {
            hideLoading();

            console.error(
              "Geolocation error:",
              error
            );
            showMapInteractionStatus(
              "Could not get your location. Check your browser location permission and try again.",
              true
            );
          },
          {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 60000
          }
        );
      }
    );

    clearLocationBtn?.addEventListener("click", event => {
      event.preventDefault();
      clearUserLocation();
    });

    searchForm?.addEventListener(
      "submit",
      event => {
        if (!validateDateRange()) {
          event.preventDefault();
          hideLoading();
          return;
        }

        showLoading(
          "Updating events",
          "Applying your filters and rebuilding the map..."
        );
      }
    );

    startDateInput?.addEventListener("change", () => {
      if (endDateInput) {
        endDateInput.min = startDateInput.value || "";

        if (
          startDateInput.value &&
          endDateInput.value &&
          endDateInput.value < startDateInput.value
        ) {
          endDateInput.value = startDateInput.value;
        }
      }

      updateDateRangeSummary();
      updateDatePresetState();
    });

    endDateInput?.addEventListener("change", () => {
      validateDateRange();
      updateDateRangeSummary();
      updateDatePresetState();
    });

    datePresetButtons.forEach(button => {
      button.addEventListener("click", () => {
        const preset = button.dataset.rangePreset;
        const today = new Date();
        today.setHours(12, 0, 0, 0);

        if (preset === "today") {
          const todayIso = toLocalIsoDate(today);
          setDateRange(todayIso, todayIso, true);
          return;
        }

        if (preset === "next3") {
          setDateRange(
            toLocalIsoDate(today),
            toLocalIsoDate(addCalendarDays(today, 2)),
            true
          );
          return;
        }

        if (preset === "weekend") {
          const dayOfWeek = today.getDay();

          if (dayOfWeek === 0) {
            const todayIso = toLocalIsoDate(today);
            setDateRange(todayIso, todayIso, true);
            return;
          }

          const daysUntilSaturday =
            dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
          const saturday = addCalendarDays(today, daysUntilSaturday);
          const sunday = addCalendarDays(saturday, 1);

          setDateRange(
            toLocalIsoDate(saturday),
            toLocalIsoDate(sunday),
            true
          );
          return;
        }

        setDateRange("", "", true);
      });
    });

    priceSelect?.addEventListener(
      "change",
      () => {
        showLoading(
          "Updating events",
          "Filtering events by price type..."
        );

        priceSelect.form?.submit();
      }
    );

    refreshEventsLink?.addEventListener(
      "click",
      () => {
        showLoading(
          "Refreshing CorkGigs",
          "Fetching the newest event listings. This may take a moment..."
        );
      }
    );

    resetFiltersLink?.addEventListener(
      "click",
      () => {
        showLoading(
          "Resetting filters",
          "Showing all Cork events again..."
        );
      }
    );

    window.addEventListener(
      "pageshow",
      hideLoading
    );

    if (startDateInput && endDateInput) {
      endDateInput.min = startDateInput.value || "";
      updateDateRangeSummary();
      updateDatePresetState();
    }

    hideLoading();
  }
})();
