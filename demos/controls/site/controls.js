const byId = (id) => document.getElementById(id);
const scenario = new URLSearchParams(location.search).get("scenario");
const section = [...document.querySelectorAll("[data-scenario]")].find(
  (element) => element.dataset.scenario === scenario,
);
if (!section) location.replace("/");
else section.hidden = false;
const status = (id, message) => {
  byId(id).textContent = message;
};
for (const event of [
  "input",
  "change",
  "click",
  "dragstart",
  "drop",
  "submit",
]) {
  document.addEventListener(event, (e) => {
    if (!section?.contains(e.target)) return;
    const item = document.createElement("li");
    item.textContent = `${event}: ${e.target.labels?.[0]?.textContent.trim() || e.target.getAttribute("aria-label") || e.target.textContent.trim() || e.target.id}`;
    byId("events").prepend(item);
    while (byId("events").children.length > 40)
      byId("events").lastElementChild.remove();
  });
}
const checkboxResult = () =>
  status(
    "checkbox-result",
    `Newsletter: ${byId("newsletter").checked ? "on" : "off"}. Priority notifications: ${byId("priority").getAttribute("aria-checked") === "true" ? "on" : "off"}.`,
  );
document.querySelectorAll('[aria-readonly="true"]').forEach((input) => {
  input.addEventListener("click", (event) => event.preventDefault());
});
byId("newsletter").onchange = checkboxResult;
byId("priority").onclick = () => {
  byId("priority").setAttribute(
    "aria-checked",
    String(byId("priority").getAttribute("aria-checked") !== "true"),
  );
  checkboxResult();
};
document.querySelectorAll("[name=delivery]").forEach((input) => {
  input.onchange = () =>
    status("radio-result", `Delivery service: ${input.value}.`);
});
const selectResult = () =>
  status(
    "select-result",
    `Shipping: ${byId("shipping").selectedOptions[0].label}. Extras: ${[...byId("extras").selectedOptions].map((option) => option.label).join(", ") || "none"}.`,
  );
byId("shipping").onchange = selectResult;
byId("extras").onchange = selectResult;
byId("travel-date").oninput = () => {
  const input = byId("travel-date");
  status(
    "date-result",
    input.validity.valid
      ? `Travel date accepted: ${input.value}.`
      : input.value
        ? `Travel date rejected: ${input.value}.`
        : "No travel date selected.",
  );
  byId("date-error").hidden = !input.value || input.validity.valid;
  status("date-error", "Travel date must be between 1 and 30 June 2030.");
};
let month = 5;
function renderCalendar() {
  const monthName = new Date(Date.UTC(2030, month, 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  status("month", `${monthName} 2030`);
  byId("days").replaceChildren();
  for (
    let day = 1;
    day <= new Date(Date.UTC(2030, month + 1, 0)).getUTCDate();
    day++
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(day);
    button.setAttribute("aria-label", `${day} ${monthName} 2030`);
    button.onclick = () => {
      status("calendar-result", `Appointment date: ${day} ${monthName} 2030.`);
      byId("calendar").hidden = true;
      byId("open-calendar").setAttribute("aria-expanded", "false");
    };
    byId("days").append(button);
  }
}
byId("open-calendar").onclick = () => {
  month = 5;
  renderCalendar();
  byId("calendar").hidden = false;
  byId("open-calendar").setAttribute("aria-expanded", "true");
  status("calendar-result", "Appointment calendar open.");
};
byId("next-month").onclick = () => {
  month++;
  renderCalendar();
};
byId("previous-month").onclick = () => {
  month--;
  renderCalendar();
};
byId("close-calendar").onclick = () => {
  byId("calendar").hidden = true;
  byId("open-calendar").setAttribute("aria-expanded", "false");
  status("calendar-result", "No appointment date selected.");
};
byId("documents").onchange = () => {
  const files = [...byId("documents").files];
  status(
    "upload-result",
    files.length
      ? `Supporting documents: ${files.map((file) => file.name).join(", ")}.`
      : "No supporting documents selected.",
  );
  byId("file-list").replaceChildren();
  for (const file of files) {
    const item = document.createElement("tr");
    for (const value of [file.name, String(file.size), file.type]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      item.append(cell);
    }
    byId("file-list").append(item);
  }
};
const sliderResult = () =>
  status(
    "slider-result",
    `Volume: ${byId("volume").value}%. Gain: ${byId("gain").getAttribute("aria-valuenow")}%.`,
  );
byId("volume").oninput = sliderResult;
byId("gain").onkeydown = (e) => {
  const value = Number(byId("gain").getAttribute("aria-valuenow"));
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? 100
        : ["ArrowRight", "ArrowUp"].includes(e.key)
          ? Math.min(100, value + 10)
          : ["ArrowLeft", "ArrowDown"].includes(e.key)
            ? Math.max(0, value - 10)
            : value;
  if (next === value) return;
  e.preventDefault();
  byId("gain").setAttribute("aria-valuenow", String(next));
  byId("gain").setAttribute("aria-valuetext", `${next} percent`);
  sliderResult();
};
byId("accent").oninput = () =>
  status("color-result", `Accent colour: ${byId("accent").value}.`);
byId("task").ondragstart = (e) =>
  e.dataTransfer.setData("text/plain", "travel-checklist");
document.querySelectorAll(".lane").forEach((lane) => {
  lane.ondragover = (e) => e.preventDefault();
  lane.ondrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.getData("text/plain") !== "travel-checklist") return;
    lane.append(byId("task"));
    status(
      "drag-result",
      lane.getAttribute("aria-label") === "Backlog"
        ? "Travel checklist is in Backlog. Completed work is empty."
        : "Travel checklist is in Completed work. Backlog is empty.",
    );
  };
});
byId("open-slots").onclick = () => {
  byId("slots").hidden = false;
  byId("open-slots").setAttribute("aria-expanded", "true");
  status("dropdown-result", "Collection selection list open.");
};
byId("slots")
  .querySelectorAll("button")
  .forEach((button) => {
    button.onclick = () => {
      byId("slots")
        .querySelectorAll("button")
        .forEach((option) =>
          option.setAttribute("aria-selected", String(option === button)),
        );
      byId("slots").hidden = true;
      byId("open-slots").setAttribute("aria-expanded", "false");
      status(
        "dropdown-result",
        `Collection slot: ${button.textContent}. Selection list closed.`,
      );
    };
  });
byId("clear-registration").onclick = () => {
  byId("registered-notes").hidden = true;
  byId("registration").reset();
  status("registration-heading", "Registration ready");
  status("registration-result", "Enter your name and email.");
  byId("registration-error").hidden = true;
  for (const input of [byId("name"), byId("email")])
    input.removeAttribute("aria-invalid");
};
byId("registration").onsubmit = (e) => {
  e.preventDefault();
  const name = byId("name").value.trim(),
    email = byId("email").value.trim();
  const errors = [];
  const notes = byId("notes").value.trim();
  if ([...name].length < 2 || [...name].length > 20)
    errors.push("Name must contain 2–20 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("Email must be a valid email address.");
  if ([...notes].length > 120)
    errors.push("Notes must contain at most 120 characters.");
  if (errors.length) {
    byId("registered-notes").hidden = true;
    status("registration-heading", "Registration rejected");
    status("registration-result", "No registration was created.");
    status("registration-error", errors.join(" "));
    byId("registration-error").hidden = false;
  } else {
    status("registration-heading", "Registration accepted");
    status("registration-result", `Registered ${name} with ${email}.`);
    byId("registered-notes").hidden = false;
    byId("name-result").value = name;
    byId("email-result").value = email;
    byId("notes-result").value = notes || "(none)";
    byId("registration-error").hidden = true;
  }
};
