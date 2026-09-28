(() => {
  "use strict";

  const PREFERENCES_KEY = "vibelee:discover-preferences:v1";
  const ONBOARDING_COMPLETE_KEY = "vibelee:onboarding-complete:v1";
  const SPLASH_SESSION_KEY = "vibelee:splash-shown:v1";

  document.addEventListener("DOMContentLoaded", initialiseOnboarding);

  function initialiseOnboarding() {
    const splash = document.getElementById("vibeleeSplash");
    const onboarding = document.getElementById("vibeleeOnboarding");

    if (!onboarding) {
      return;
    }

    const interestButtons = Array.from(
      onboarding.querySelectorAll("[data-onboarding-interest]")
    );
    const budgetButtons = Array.from(
      onboarding.querySelectorAll("[data-onboarding-budget]")
    );
    const scopeButtons = Array.from(
      onboarding.querySelectorAll("[data-onboarding-scope]")
    );
    const stepPanels = Array.from(
      onboarding.querySelectorAll("[data-onboarding-step]")
    );
    const progressItems = Array.from(
      onboarding.querySelectorAll("[data-onboarding-progress]")
    );

    const continueButton = document.getElementById(
      "onboardingContinueButton"
    );
    const backButton = document.getElementById("onboardingBackButton");
    const saveButton = document.getElementById("onboardingSaveButton");
    const skipButton = document.getElementById("onboardingSkipButton");
    const resetButton = document.getElementById("onboardingResetButton");
    const interestError = document.getElementById(
      "onboardingInterestError"
    );
    const editButtons = [
      document.getElementById("editInterestsBtn"),
      document.getElementById("personalisedEditBtn")
    ].filter(Boolean);

    let currentStep = 1;
    let selectedInterests = new Set();
    let selectedBudget = "any";
    let selectedScope = "nearby";
    let previouslyFocusedElement = null;

    function storageGet(storage, key) {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    }

    function storageSet(storage, key, value) {
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }

    function storageRemove(storage, key) {
      try {
        storage.removeItem(key);
      } catch {
        // The interface still works without persistent storage.
      }
    }

    function readPreferences() {
      const raw = storageGet(window.localStorage, PREFERENCES_KEY);

      if (!raw) {
        return null;
      }

      try {
        const parsed = JSON.parse(raw);
        const validInterests = new Set([
          "music",
          "nightlife",
          "comedy",
          "trad",
          "open-mic",
          "festivals"
        ]);
        const validBudgets = new Set(["any", "free", "paid"]);
        const validScopes = new Set(["centre", "nearby", "any"]);

        const interests = Array.isArray(parsed.interests)
          ? parsed.interests.filter(interest => validInterests.has(interest))
          : [];
        const budget = validBudgets.has(parsed.budget)
          ? parsed.budget
          : "any";
        const scope = validScopes.has(parsed.scope)
          ? parsed.scope
          : "nearby";

        return {
          interests,
          budget,
          scope
        };
      } catch {
        return null;
      }
    }

    function savePreferences(preferences) {
      storageSet(
        window.localStorage,
        PREFERENCES_KEY,
        JSON.stringify({
          ...preferences,
          savedAt: new Date().toISOString()
        })
      );
      storageSet(window.localStorage, ONBOARDING_COMPLETE_KEY, "true");
    }

    function markOnboardingComplete() {
      storageSet(window.localStorage, ONBOARDING_COMPLETE_KEY, "true");
    }

    function onboardingHasBeenCompleted() {
      return (
        storageGet(window.localStorage, ONBOARDING_COMPLETE_KEY) === "true"
      );
    }

    function setPressedState(buttons, selectedValue) {
      buttons.forEach(button => {
        const value =
          button.dataset.onboardingBudget ||
          button.dataset.onboardingScope ||
          "";
        const isSelected = value === selectedValue;

        button.classList.toggle("active", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      });
    }

    function updateInterestButtons() {
      interestButtons.forEach(button => {
        const interest = button.dataset.onboardingInterest;
        const isSelected = selectedInterests.has(interest);

        button.classList.toggle("active", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
      });
    }

    function populatePreferences(preferences) {
      selectedInterests = new Set(preferences?.interests || []);
      selectedBudget = preferences?.budget || "any";
      selectedScope = preferences?.scope || "nearby";

      updateInterestButtons();
      setPressedState(budgetButtons, selectedBudget);
      setPressedState(scopeButtons, selectedScope);
      resetButton?.toggleAttribute("hidden", !preferences);
    }

    function setStep(stepNumber) {
      currentStep = stepNumber;

      stepPanels.forEach(panel => {
        const panelStep = Number(panel.dataset.onboardingStep);
        const isActive = panelStep === currentStep;

        panel.classList.toggle("active", isActive);
        panel.hidden = !isActive;
      });

      progressItems.forEach(item => {
        const itemStep = Number(item.dataset.onboardingProgress);
        item.classList.toggle("active", itemStep <= currentStep);
      });

      const focusTarget =
        currentStep === 1
          ? interestButtons.find(button =>
              button.classList.contains("active")
            ) || interestButtons[0]
          : budgetButtons.find(button =>
              button.classList.contains("active")
            ) || budgetButtons[0];

      window.setTimeout(() => focusTarget?.focus(), 40);
    }

    function openOnboarding({ fromEdit = false } = {}) {
      previouslyFocusedElement = document.activeElement;
      populatePreferences(readPreferences());
      setStep(1);

      onboarding.hidden = false;
      onboarding.setAttribute("aria-hidden", "false");
      onboarding.classList.toggle("is-editing", fromEdit);
      document.body.classList.add("onboarding-active");

      if (skipButton) {
        skipButton.textContent = fromEdit ? "Close" : "Skip for now";
      }

      window.setTimeout(() => {
        onboarding.classList.add("visible");
      }, 20);
    }

    function closeOnboarding() {
      onboarding.classList.remove("visible");
      onboarding.setAttribute("aria-hidden", "true");
      document.body.classList.remove("onboarding-active");

      window.setTimeout(() => {
        onboarding.hidden = true;
        previouslyFocusedElement?.focus?.();
      }, 260);
    }

    function currentUrlContainsDiscoveryIntent() {
      const params = new URLSearchParams(window.location.search);
      const intentionalKeys = [
        "q",
        "from",
        "to",
        "date",
        "categories",
        "category",
        "price",
        "scope",
        "personalized",
        "personalised"
      ];

      return intentionalKeys.some(key => params.has(key));
    }

    function applyPreferences(preferences, { replace = false } = {}) {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      if (preferences.interests.length > 0) {
        params.set("categories", preferences.interests.join(","));
      } else {
        params.delete("categories");
        params.delete("category");
      }

      if (preferences.budget === "any") {
        params.delete("price");
      } else {
        params.set("price", preferences.budget);
      }

      params.set("scope", preferences.scope || "nearby");
      params.set("personalized", "1");
      params.delete("personalised");

      const destination = `${url.pathname}?${params.toString()}${url.hash}`;

      if (replace) {
        window.location.replace(destination);
      } else {
        window.location.assign(destination);
      }
    }

    function showSplash(afterSplash) {
      if (!splash) {
        afterSplash();
        return;
      }

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const duration = reducedMotion ? 350 : 1450;

      splash.hidden = false;
      splash.setAttribute("aria-hidden", "false");
      document.body.classList.add("splash-active");

      window.requestAnimationFrame(() => {
        splash.classList.add("visible");
      });

      window.setTimeout(() => {
        splash.classList.add("leaving");

        window.setTimeout(() => {
          splash.hidden = true;
          splash.classList.remove("visible", "leaving");
          splash.setAttribute("aria-hidden", "true");
          document.body.classList.remove("splash-active");
          afterSplash();
        }, reducedMotion ? 80 : 380);
      }, duration);
    }

    function continueAfterSplash() {
      const savedPreferences = readPreferences();
      const hasCompleted = onboardingHasBeenCompleted();
      const params = new URLSearchParams(window.location.search);
      const explicitlyShowingAll = params.get("personalized") === "0";

      if (!hasCompleted) {
        openOnboarding();
        return;
      }

      if (
        savedPreferences &&
        !explicitlyShowingAll &&
        !currentUrlContainsDiscoveryIntent()
      ) {
        applyPreferences(savedPreferences, { replace: true });
      }
    }

    interestButtons.forEach(button => {
      button.addEventListener("click", () => {
        const interest = button.dataset.onboardingInterest;

        if (!interest) {
          return;
        }

        if (selectedInterests.has(interest)) {
          selectedInterests.delete(interest);
        } else {
          selectedInterests.add(interest);
        }

        interestError?.setAttribute("hidden", "");
        updateInterestButtons();
      });
    });

    budgetButtons.forEach(button => {
      button.addEventListener("click", () => {
        selectedBudget = button.dataset.onboardingBudget || "any";
        setPressedState(budgetButtons, selectedBudget);
      });
    });

    scopeButtons.forEach(button => {
      button.addEventListener("click", () => {
        selectedScope = button.dataset.onboardingScope || "nearby";
        setPressedState(scopeButtons, selectedScope);
      });
    });

    continueButton?.addEventListener("click", () => {
      if (selectedInterests.size === 0) {
        interestError?.removeAttribute("hidden");
        interestButtons[0]?.focus();
        return;
      }

      interestError?.setAttribute("hidden", "");
      setStep(2);
    });

    backButton?.addEventListener("click", () => setStep(1));

    saveButton?.addEventListener("click", () => {
      const preferences = {
        interests: [...selectedInterests],
        budget: selectedBudget,
        scope: selectedScope
      };

      savePreferences(preferences);
      applyPreferences(preferences);
    });

    skipButton?.addEventListener("click", () => {
      markOnboardingComplete();
      closeOnboarding();
    });

    resetButton?.addEventListener("click", () => {
      storageRemove(window.localStorage, PREFERENCES_KEY);
      storageSet(window.localStorage, ONBOARDING_COMPLETE_KEY, "true");
      selectedInterests.clear();
      selectedBudget = "any";
      selectedScope = "nearby";
      window.location.assign("/?personalized=0");
    });

    editButtons.forEach(button => {
      button.addEventListener("click", () => {
        openOnboarding({ fromEdit: true });
      });
    });

    onboarding.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        markOnboardingComplete();
        closeOnboarding();
      }
    });

    const splashAlreadyShown =
      storageGet(window.sessionStorage, SPLASH_SESSION_KEY) === "true";

    if (splashAlreadyShown) {
      continueAfterSplash();
    } else {
      storageSet(window.sessionStorage, SPLASH_SESSION_KEY, "true");
      showSplash(continueAfterSplash);
    }
  }
})();
