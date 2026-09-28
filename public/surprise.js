document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("surpriseFilterForm");
  const submitButton = document.getElementById("surpriseSubmitButton");
  const rerollButton = document.getElementById("surpriseRerollButton");

  if (form && submitButton) {
    form.addEventListener("submit", () => {
      submitButton.disabled = true;
      submitButton.textContent = "Choosing…";
      document.body.classList.add("surprise-is-loading");
    });
  }

  if (rerollButton) {
    rerollButton.addEventListener("click", () => {
      rerollButton.classList.add("is-loading");
      rerollButton.setAttribute("aria-disabled", "true");
      rerollButton.firstChild.textContent = "Picking another event ";
      document.body.classList.add("surprise-is-loading");
    });
  }
});
