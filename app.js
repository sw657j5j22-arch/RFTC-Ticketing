const STORAGE_KEY = "rftc-ticketing-prototype-v2";
const HOLD_MINUTES = 15;
const roles = {
  visitor: "visiteur",
  client: "client",
  admin: "équipe RFTC",
  organizer: "responsable événement",
  agent: "agent de contrôle",
  vendor: "vendeur"
};
const navigation = [
  { page: "events", label: "Événements", roles: Object.keys(roles) },
  { page: "my-tickets", label: "Mes billets", roles: ["client"] },
  { page: "dashboard", label: "Tableau de bord", roles: ["admin", "organizer", "vendor"] },
  { page: "events-admin", label: "Gestion", roles: ["admin", "organizer"] },
  { page: "scanner", label: "Scanner", roles: ["admin", "agent"] },
  { page: "pos", label: "Point de vente", roles: ["admin", "vendor"] },
  { page: "reports", label: "Rapports", roles: ["admin", "organizer"] }
];
const seedEvents = [
  {
    id: "nuit-des-voix", category: "Concert", date: "2026-11-21T19:00:00+01:00",
    title: "La Nuit des Voix", city: "Douala · Institut français",
    description: "Une scène, des voix singulières et des rythmes qui voyagent.",
    art: "concert", artLabel: "LES VOIX", status: "published",
    ticketTypes: [
      { id: "standard", name: "Standard", price: 5000, quota: 400, sold: 0 },
      { id: "vip", name: "VIP", price: 12000, quota: 70, sold: 0 },
      { id: "early", name: "VIP Early Bird", price: 8000, quota: 40, sold: 0 }
    ]
  },
  {
    id: "rftc-sound-system", category: "Festival", date: "2026-12-05T18:30:00+01:00",
    title: "RFTC Sound System", city: "Douala · Parcours Vita",
    description: "Une soirée généreuse entre sons afro, soul et découvertes.",
    art: "festival", artLabel: "SOUND", status: "published",
    ticketTypes: [
      { id: "standard", name: "Standard", price: 7500, quota: 1000, sold: 0 },
      { id: "vip", name: "VIP", price: 15000, quota: 100, sold: 0 },
      { id: "backstage", name: "Backstage", price: 25000, quota: 30, sold: 0 }
    ]
  },
  {
    id: "culture-lab", category: "Atelier", date: "2026-12-13T14:00:00+01:00",
    title: "Culture Lab", city: "Douala · Bonanjo",
    description: "Un atelier créatif pour imaginer ensemble la culture de demain.",
    art: "atelier", artLabel: "CREATE", status: "published",
    ticketTypes: [
      { id: "standard", name: "Standard", price: 3000, quota: 60, sold: 0 },
      { id: "free", name: "Gratuit", price: 0, quota: 20, sold: 0 }
    ]
  }
];

function freshState() {
  return { events: structuredClone(seedEvents), orders: [], role: "visitor" };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return freshState();
  const parsed = JSON.parse(saved);
  if (!Array.isArray(parsed.events) || !Array.isArray(parsed.orders)) {
    throw new Error("Les données locales du prototype sont incomplètes. Réinitialise la démo pour continuer.");
  }
  return { ...freshState(), ...parsed };
}

let state;
let storageAvailable = true;
try {
  state = loadState();
} catch (error) {
  console.error("Chargement de la démo impossible :", error);
  state = freshState();
  storageAvailable = false;
}

const cart = new Map();
const elements = {
  nav: document.querySelector("#app-nav"),
  role: document.querySelector("#demo-role"),
  events: document.querySelector("#events-grid"),
  filters: document.querySelector("#event-filters"),
  drawer: document.querySelector("#cart-drawer"),
  overlay: document.querySelector("#overlay"),
  checkout: document.querySelector("#checkout-modal"),
  ticketModal: document.querySelector("#ticket-modal"),
  eventModal: document.querySelector("#event-modal"),
  choiceModal: document.querySelector("#ticket-choice-modal")
};
let activePage = "events";
let activeOrderId = null;
let selectedEventId = null;
let lastFocusedElement = null;
let toastTimer;
let holdTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function persist() {
  if (!storageAvailable) {
    showToast("Stockage local indisponible : les changements ne seront pas conservés.");
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Enregistrement local impossible :", error);
    showToast("Enregistrement impossible dans le navigateur.");
    return false;
  }
}

function money(value) {
  return `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
}

function dateLabel(value, includeTime = false) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala",
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function createToken() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `RFTC${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function createReference(prefix) {
  return `${prefix}-${createToken().slice(-8)}`;
}

function findEvent(id) {
  return state.events.find((event) => event.id === id);
}

function findTicketType(event, typeId) {
  return event?.ticketTypes.find((type) => type.id === typeId);
}

function heldQuantity(eventId, typeId, excludingOrderId = null) {
  return state.orders.reduce((sum, order) => {
    if (order.id === excludingOrderId || order.status !== "pending" || order.expiresAt <= Date.now()) return sum;
    return sum + order.items.reduce((lineSum, item) => lineSum + (item.eventId === eventId && item.typeId === typeId ? item.quantity : 0), 0);
  }, 0);
}

function availableQuantity(event, type) {
  return Math.max(0, type.quota - type.sold - heldQuantity(event.id, type.id));
}

function ticketsInOrder(order) {
  return order.tickets ?? [];
}

function confirmedOrders() {
  return state.orders.filter((order) => order.status === "confirmed");
}

function totalSoldTickets() {
  return confirmedOrders().reduce((sum, order) => sum + ticketsInOrder(order).length, 0);
}

function totalEntries() {
  return confirmedOrders().reduce((sum, order) => sum + ticketsInOrder(order).filter((ticket) => ticket.status === "used").length, 0);
}

function totalRevenue(orders = confirmedOrders()) {
  return orders.reduce((sum, order) => sum + order.total, 0);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function updateNavigation() {
  elements.role.value = state.role;
  elements.nav.innerHTML = navigation
    .filter((item) => item.roles.includes(state.role))
    .map((item) => `<button class="nav-link ${activePage === item.page ? "active" : ""}" type="button" data-go="${item.page}">${item.label}</button>`)
    .join("");
  document.querySelectorAll(".app-page").forEach((page) => {
    page.hidden = page.dataset.page !== activePage;
  });
  if (activePage === "dashboard") renderDashboard();
  if (activePage === "events-admin") renderAdminEvents();
  if (activePage === "scanner") renderDemoTokens();
  if (activePage === "pos") renderPointOfSale();
  if (activePage === "reports") renderReports();
  if (activePage === "my-tickets") renderMyTickets();
}

function goToPage(page) {
  const allowed = navigation.find((item) => item.page === page)?.roles.includes(state.role);
  if (!allowed) {
    showToast("Ce profil démo n’a pas accès à cet écran.");
    return;
  }
  activePage = page;
  updateNavigation();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function eventCard(event) {
  const categories = event.ticketTypes.filter((type) => type.quota > 0);
  const cheapest = categories.reduce((min, type) => Math.min(min, type.price), Infinity);
  const available = categories.reduce((sum, type) => sum + availableQuantity(event, type), 0);
  const graphic = event.art === "concert"
    ? '<span class="art-sun"></span><span class="art-rings"></span>'
    : event.art === "festival"
      ? '<span class="art-disc"></span><span class="art-rings"></span>'
      : '<span class="art-sun"></span><span class="art-lines"></span>';
  return `
    <article class="event-card">
      <div class="event-art ${escapeHtml(event.art)}">${graphic}
        <span class="event-category">${escapeHtml(event.category)}</span>
        <span class="event-art-label">${escapeHtml(event.artLabel || event.title)}</span>
      </div>
      <div class="event-body">
        <div class="event-date">${escapeHtml(dateLabel(event.date))}</div>
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <div class="event-meta"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>${escapeHtml(event.city)}</span><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${escapeHtml(timeLabel(event.date))}</span></div>
        <p class="event-description">${escapeHtml(event.description || "Une rencontre culturelle à ne pas manquer.")}</p>
        <div class="event-divider"></div>
        <div class="event-buy-row"><div class="event-price"><strong>${Number.isFinite(cheapest) ? money(cheapest) : "Complet"}</strong><span>à partir de · ${available} places</span></div><button class="add-ticket" type="button" data-add="${escapeHtml(event.id)}" ${available === 0 ? "disabled" : ""} aria-label="Choisir un billet pour ${escapeHtml(event.title)}">${available === 0 ? "—" : "+"}</button></div>
      </div>
    </article>`;
}

function renderEvents(category = "Tous") {
  const categories = ["Tous", ...new Set(state.events.filter((event) => event.status === "published").map((event) => event.category))];
  if (!categories.includes(category)) category = "Tous";
  elements.filters.innerHTML = categories.map((filter) => {
    const count = filter === "Tous" ? state.events.filter((event) => event.status === "published").length : state.events.filter((event) => event.status === "published" && event.category === filter).length;
    return `<button class="filter-chip ${filter === category ? "active" : ""}" type="button" data-filter="${escapeHtml(filter)}">${escapeHtml(filter === "Tous" ? "Tout voir" : filter)} <span>${String(count).padStart(2, "0")}</span></button>`;
  }).join("");
  const visibleEvents = state.events.filter((event) => event.status === "published" && (category === "Tous" || event.category === category));
  elements.events.innerHTML = visibleEvents.length
    ? visibleEvents.map(eventCard).join("")
    : '<div class="empty-state"><span class="empty-state-icon">✳</span><h3>La programmation se prépare.</h3><p>Reviens bientôt pour découvrir les prochains rendez-vous RFTC.</p></div>';
}

function cartQuantity() {
  return [...cart.values()].reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal() {
  return [...cart.values()].reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function renderCart() {
  const items = [...cart.values()];
  const quantity = cartQuantity();
  document.querySelector("#cart-count").textContent = quantity;
  document.querySelector("#drawer-count").textContent = `(${quantity})`;
  document.querySelector("#cart-footer").hidden = items.length === 0;
  document.querySelector("#cart-total").textContent = money(cartTotal());
  document.querySelector("#cart-items").innerHTML = items.length
    ? items.map((item) => `<article class="cart-item"><div><h3>${escapeHtml(item.eventTitle)}</h3><p>${escapeHtml(item.typeName)} · ${item.quantity} billet${item.quantity > 1 ? "s" : ""}</p></div><div class="cart-item-price">${money(item.price * item.quantity)}<button type="button" data-remove="${escapeHtml(item.key)}">Retirer</button></div></article>`).join("")
    : '<div class="empty-cart"><span class="empty-cart-icon">✳</span>Ton panier attend ses premières vibrations.</div>';
}

function setOverlay(open) {
  elements.overlay.hidden = !open;
  document.body.classList.toggle("modal-open", open);
}

function closePanels() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".app-modal").forEach((modal) => modal.classList.remove("open"));
  window.setTimeout(() => {
    if (!elements.drawer.classList.contains("open") && !document.querySelector(".app-modal.open")) {
      document.querySelectorAll(".app-modal").forEach((modal) => { modal.hidden = true; });
      setOverlay(false);
    }
  }, 220);
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function openModal(modal) {
  lastFocusedElement = document.activeElement;
  setOverlay(true);
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add("open"));
  modal.querySelector("input:not([type=hidden]), select, button")?.focus();
}

function openCart() {
  lastFocusedElement = document.activeElement;
  renderCart();
  setOverlay(true);
  elements.drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => elements.drawer.classList.add("open"));
  document.querySelector("#close-cart").focus();
}

function gfMultiply(left, right) {
  let result = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result & 0x80) ? 0x11d : 0);
    if ((right >>> bit) & 1) result ^= left;
  }
  return result;
}

function qrCodeSvg(text) {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > 17) throw new Error("Le jeton dépasse la capacité du QR de démonstration.");
  let bits = [0, 1, 0, 0];
  const appendBits = (value, length) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };
  appendBits(bytes.length, 8);
  bytes.forEach((byte) => appendBits(byte, 8));
  for (let i = 0; i < Math.min(4, 152 - bits.length); i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((word, bit) => (word << 1) | bit, 0));
  for (let pad = 0; data.length < 19; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  let generator = [1], root = 1;
  for (let i = 0; i < 7; i += 1) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMultiply(coefficient, root);
    });
    generator = next;
    root = gfMultiply(root, 2);
  }
  const remainder = [...data, ...new Array(7).fill(0)];
  data.forEach((_, index) => {
    const factor = remainder[index];
    if (factor) generator.forEach((coefficient, offset) => { remainder[index + offset] ^= gfMultiply(coefficient, factor); });
  });
  const codewords = [...data, ...remainder.slice(19)];
  const size = 21;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (x, y, value) => { matrix[y][x] = value; };
  for (const [left, top] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = -1; y <= 7; y += 1) for (let x = -1; x <= 7; x += 1) {
      const px = left + x, py = top + y;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      set(px, py, inside && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)));
    }
  }
  for (let i = 8; i < size - 8; i += 1) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const formatData = 0b01000;
  let formatRemainder = formatData << 10;
  for (let bit = 14; bit >= 10; bit -= 1) if ((formatRemainder >>> bit) & 1) formatRemainder ^= 0x537 << (bit - 10);
  const format = ((formatData << 10) | formatRemainder) ^ 0x5412;
  for (let i = 0; i <= 5; i += 1) set(8, i, ((format >>> i) & 1) !== 0);
  set(8, 7, ((format >>> 6) & 1) !== 0); set(8, 8, ((format >>> 7) & 1) !== 0); set(7, 8, ((format >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, ((format >>> i) & 1) !== 0);
  set(8, size - 8, true);
  let bitIndex = 0, upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (matrix[y][x] !== null) continue;
        const rawBit = (codewords[Math.floor(bitIndex / 8)] >>> (7 - (bitIndex % 8))) & 1;
        matrix[y][x] = (rawBit ^ (y % 2 === 0 ? 1 : 0)) === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  const modules = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : []));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 29 29" role="img" aria-label="QR de démonstration pour le billet ${text}"><rect x="-4" y="-4" width="29" height="29" fill="#fff"/><g fill="#21133b">${modules.join("")}</g></svg>`;
}

function makeTickets(order) {
  const tickets = [];
  for (const item of order.items) {
    const event = findEvent(item.eventId);
    const type = findTicketType(event, item.typeId);
    if (!event || !type) throw new Error("Une catégorie de billet de la commande n’existe plus.");
    for (let index = 0; index < item.quantity; index += 1) {
      tickets.push({
        id: createReference("BIL"),
        token: createToken(),
        eventId: event.id,
        eventTitle: event.title,
        typeName: type.name,
        price: type.price,
        status: "valid",
        checkedInAt: null
      });
    }
  }
  return tickets;
}

function finalizeOrder(order, method, source, vendor) {
  order.status = "confirmed";
  order.paymentMethod = method;
  order.source = source;
  order.vendor = vendor;
  order.confirmedAt = Date.now();
  order.tickets = makeTickets(order);
  for (const item of order.items) {
    const event = findEvent(item.eventId);
    const type = findTicketType(event, item.typeId);
    if (!type) throw new Error("Catégorie de billet introuvable pendant la confirmation.");
    type.sold += item.quantity;
  }
}

function expirePendingOrders() {
  const now = Date.now();
  let changed = false;
  state.orders.forEach((order) => {
    if (order.status === "pending" && order.expiresAt <= now) {
      order.status = "expired";
      order.expiredAt = now;
      changed = true;
    }
  });
  if (changed) persist();
}

function ticketTypeOption(event, type) {
  const remaining = availableQuantity(event, type);
  return `<option value="${escapeHtml(type.id)}" ${remaining === 0 ? "disabled" : ""}>${escapeHtml(type.name)} · ${money(type.price)} · ${remaining} dispo.</option>`;
}

function openTicketChoice(eventId) {
  const event = findEvent(eventId);
  if (!event || event.status !== "published") return;
  selectedEventId = eventId;
  const select = document.querySelector("#choice-type");
  select.innerHTML = event.ticketTypes.map((type) => ticketTypeOption(event, type)).join("");
  document.querySelector("#choice-event-info").textContent = `${event.title} · ${dateLabel(event.date, true)} · ${event.city}`;
  document.querySelector("#ticket-choice-form").reset();
  updateChoiceAvailability();
  openModal(elements.choiceModal);
}

function updateChoiceAvailability() {
  const event = findEvent(selectedEventId);
  const type = findTicketType(event, document.querySelector("#choice-type").value);
  const quantity = Number(document.querySelector("#ticket-choice-form [name=quantity]").value || 1);
  const remaining = event && type ? availableQuantity(event, type) : 0;
  document.querySelector("#choice-availability").textContent = type
    ? `${money(type.price)} par billet · ${remaining} place${remaining === 1 ? "" : "s"} disponible${remaining === 1 ? "" : "s"}`
    : "Aucune place disponible dans cette catégorie.";
  document.querySelector("#ticket-choice-form button[type=submit]").disabled = !type || quantity < 1 || quantity > Math.min(10, remaining);
}

function addToCart(eventId, typeId, quantity) {
  const event = findEvent(eventId), type = findTicketType(event, typeId);
  if (!event || !type || event.status !== "published") return;
  const key = `${event.id}:${type.id}`;
  const existing = cart.get(key);
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > availableQuantity(event, type)) {
    showToast("Le quota disponible ne permet pas cette quantité.");
    return;
  }
  cart.set(key, {
    key, eventId: event.id, typeId: type.id, eventTitle: event.title,
    typeName: type.name, price: type.price, quantity: nextQuantity
  });
  renderCart();
  renderEvents();
  closePanels();
  showToast(`${quantity} billet${quantity > 1 ? "s" : ""} ajouté${quantity > 1 ? "s" : ""} au panier.`);
}

function openCheckout() {
  if (cart.size === 0) return;
  document.querySelector("#checkout-summary").innerHTML = `<span>${cartQuantity()} billet${cartQuantity() > 1 ? "s" : ""}</span><strong>${money(cartTotal())}</strong>`;
  document.querySelector("#checkout-form").hidden = false;
  document.querySelector("#payment-pending").hidden = true;
  document.querySelector("#checkout-form").reset();
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  openModal(elements.checkout);
}

function createPendingOrder(form) {
  for (const item of cart.values()) {
    const event = findEvent(item.eventId), type = findTicketType(event, item.typeId);
    if (!event || !type || item.quantity > availableQuantity(event, type)) {
      showToast("Une catégorie n’a plus assez de places. Vérifie ton panier.");
      return;
    }
  }
  const formData = new FormData(form);
  const now = Date.now();
  const order = {
    id: createReference("CMD"),
    name: String(formData.get("name")).trim(),
    email: String(formData.get("email")).trim(),
    phone: String(formData.get("phone")).trim(),
    paymentMethod: String(formData.get("payment")),
    source: "web",
    vendor: "Web",
    status: "pending",
    createdAt: now,
    expiresAt: now + HOLD_MINUTES * 60 * 1000,
    total: cartTotal(),
    items: [...cart.values()].map(({ eventId, typeId, quantity, price }) => ({ eventId, typeId, quantity, price })),
    tickets: []
  };
  state.orders.push(order);
  activeOrderId = order.id;
  cart.clear();
  persist();
  renderCart();
  renderEvents();
  form.hidden = true;
  document.querySelector("#payment-pending").hidden = false;
  document.querySelector("#pending-reference").textContent = `${order.id} · ${money(order.total)}`;
  updateHoldCountdown();
  window.clearInterval(holdTimer);
  holdTimer = window.setInterval(updateHoldCountdown, 1000);
}

function updateHoldCountdown() {
  const order = state.orders.find((item) => item.id === activeOrderId);
  if (!order || order.status !== "pending") {
    window.clearInterval(holdTimer);
    return;
  }
  const seconds = Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 1000));
  document.querySelector("#pending-reference").textContent = `${order.id} · ${money(order.total)} · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (seconds === 0) {
    expirePendingOrders();
    window.clearInterval(holdTimer);
    document.querySelector("#payment-pending").hidden = true;
    document.querySelector("#checkout-form").hidden = false;
    showToast("La réservation temporaire a expiré et les places ont été libérées.");
  }
}

function showIssuedTickets(order, titleText = "RÉSERVATION CONFIRMÉE · DÉMO") {
  if (!order) return;
  document.querySelector("#ticket-kicker").textContent = titleText;
  document.querySelector("#ticket-name").textContent = order.name || "ami·e RFTC";
  document.querySelector("#ticket-summary").textContent = `${order.id} · ${money(order.total)} · ${dateLabel(order.confirmedAt || order.createdAt, true)}`;
  document.querySelector("#issued-tickets").innerHTML = ticketsInOrder(order).map((ticket) => `
    <article class="issued-ticket">
      <div class="qr-code">${qrCodeSvg(ticket.token)}</div>
      <div class="issued-ticket-info"><strong>${escapeHtml(ticket.eventTitle)}</strong><span>${escapeHtml(ticket.typeName)} · ${money(ticket.price)}</span><code>${escapeHtml(ticket.token)}</code></div>
      <span class="ticket-validity ${ticket.status === "used" ? "used" : ""}">${ticket.status === "used" ? "DÉJÀ SCANNÉ" : "VALIDE · DÉMO"}</span>
    </article>`).join("");
  openModal(elements.ticketModal);
  renderMyTickets();
}

function completeDemoPayment(success) {
  const order = state.orders.find((item) => item.id === activeOrderId);
  if (!order || order.status !== "pending") {
    showToast("Cette demande de paiement n’est plus en attente.");
    return;
  }
  window.clearInterval(holdTimer);
  if (order.expiresAt <= Date.now()) {
    expirePendingOrders();
    showToast("Le délai de réservation est dépassé. Les places ont été libérées.");
    return;
  }
  if (!success) {
    order.status = "rejected";
    order.rejectedAt = Date.now();
    persist();
    renderEvents();
    closePanels();
    showToast("Paiement démo refusé : réservation annulée et quota libéré.");
    return;
  }
  finalizeOrder(order, order.paymentMethod, "web", "Web");
  renderEvents();
  renderDashboard();
  closePanels();
  showIssuedTickets(order);
}

function openEventForm(event = null) {
  const form = document.querySelector("#event-form");
  form.reset();
  form.elements.eventId.value = event?.id ?? "";
  document.querySelector("#event-modal-title").innerHTML = event ? "Modifier un <span>événement.</span>" : "Créer un <span>événement.</span>";
  if (event) {
    form.elements.title.value = event.title;
    form.elements.category.value = event.category;
    form.elements.city.value = event.city;
    form.elements.date.value = new Date(event.date).toISOString().slice(0, 16);
    form.elements.ticketName.value = event.ticketTypes[0]?.name ?? "Standard";
    form.elements.price.value = event.ticketTypes[0]?.price ?? 5000;
    form.elements.quota.value = event.ticketTypes[0]?.quota ?? 100;
    form.elements.description.value = event.description ?? "";
  }
  openModal(elements.eventModal);
}

function renderAdminEvents() {
  document.querySelector("#admin-event-list").innerHTML = state.events.map((event) => {
    const sold = event.ticketTypes.reduce((sum, type) => sum + type.sold, 0);
    const quota = event.ticketTypes.reduce((sum, type) => sum + type.quota, 0);
    const status = event.status === "published" ? "Publié" : event.status === "draft" ? "Brouillon" : event.status === "cancelled" ? "Annulé" : event.status === "completed" ? "Terminé" : "Complet";
    return `<article class="admin-event-card"><div class="admin-event-main"><div class="event-mini-art ${escapeHtml(event.art)}">${escapeHtml((event.artLabel || event.title).slice(0, 2))}</div><div><span class="status-pill status-${escapeHtml(event.status)}">${status}</span><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(dateLabel(event.date, true))} · ${escapeHtml(event.city)}</p><div class="event-admin-stats">${event.ticketTypes.map((type) => `<span>${escapeHtml(type.name)} · ${money(type.price)} · ${type.sold}/${type.quota}</span>`).join("")}</div></div></div><div class="admin-event-actions"><button class="secondary-button" data-event-action="edit" data-event-id="${escapeHtml(event.id)}">Modifier</button><button class="secondary-button" data-event-action="duplicate" data-event-id="${escapeHtml(event.id)}">Dupliquer</button><button class="secondary-button" data-event-action="status" data-event-id="${escapeHtml(event.id)}">${event.status === "published" ? "Dépublier" : "Publier"}</button><button class="text-button danger-text" data-event-action="cancel" data-event-id="${escapeHtml(event.id)}">Clôturer</button></div></article>`;
  }).join("");
}

function renderDashboard() {
  const orders = confirmedOrders();
  const pending = state.orders.filter((order) => order.status === "pending").length;
  const eventsCount = state.events.filter((event) => event.status === "published").length;
  document.querySelector("#dashboard-greeting").textContent = roles[state.role] || "équipe RFTC";
  document.querySelector("#dashboard-stats").innerHTML = [
    { label: "Événements publiés", value: eventsCount, note: "dans la programmation", icon: "✳" },
    { label: "Billets confirmés", value: totalSoldTickets(), note: "web + point de vente", icon: "▣" },
    { label: "Entrées validées", value: totalEntries(), note: "QR contrôlés", icon: "✓" },
    { label: "Encaissements démo", value: money(totalRevenue(orders)), note: `${pending} paiement${pending === 1 ? "" : "s"} en attente`, icon: "↗" }
  ].map((stat) => `<article class="stat-card"><span class="stat-icon">${stat.icon}</span><span class="stat-label">${stat.label}</span><strong>${stat.value}</strong><span class="stat-note">${stat.note}</span></article>`).join("");
  const latest = [...state.orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  document.querySelector("#recent-orders").innerHTML = latest.length ? latest.map((order) => `<div class="activity-row"><span class="activity-dot ${order.status}"></span><div><strong>${escapeHtml(order.id)} · ${escapeHtml(order.name || "Vente comptoir")}</strong><small>${escapeHtml(order.status === "confirmed" ? "Confirmée" : order.status === "pending" ? "En attente" : order.status === "rejected" ? "Refusée" : "Expirée")} · ${escapeHtml(order.vendor)}</small></div><b>${money(order.total)}</b></div>`).join("") : '<div class="empty-state compact">Les réservations et ventes apparaîtront ici.</div>';
  const upcoming = state.events.filter((event) => event.status === "published").slice(0, 4);
  document.querySelector("#upcoming-events").innerHTML = upcoming.length ? upcoming.map((event) => `<div class="upcoming-row"><span class="upcoming-date">${escapeHtml(dateLabel(event.date).split(" ").slice(0, 2).join(" "))}</span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.city)}</small></div><span class="upcoming-count">${event.ticketTypes.reduce((sum, type) => sum + type.sold, 0)} vendus</span></div>`).join("") : '<div class="empty-state compact">Aucun événement publié.</div>';
}

function renderPointOfSale() {
  const eventSelect = document.querySelector("#pos-event");
  const oldEventId = eventSelect.value;
  const availableEvents = state.events.filter((event) => event.status === "published");
  eventSelect.innerHTML = availableEvents.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.title)}</option>`).join("");
  if (availableEvents.some((event) => event.id === oldEventId)) eventSelect.value = oldEventId;
  updatePosTicketTypes();
  const recent = [...confirmedOrders()].filter((order) => order.source === "pos").sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  document.querySelector("#pos-sales").innerHTML = recent.length ? recent.map((order) => `<div class="activity-row"><span class="activity-dot confirmed"></span><div><strong>${escapeHtml(order.id)}</strong><small>${escapeHtml(paymentLabel(order.paymentMethod))} · ${order.tickets.length} billet${order.tickets.length > 1 ? "s" : ""}</small></div><b>${money(order.total)}</b></div>`).join("") : '<div class="empty-state compact">Aucune vente comptoir pour le moment.</div>';
}

function updatePosTicketTypes() {
  const event = findEvent(document.querySelector("#pos-event").value);
  const typeSelect = document.querySelector("#pos-type");
  typeSelect.innerHTML = event ? event.ticketTypes.map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)} · ${money(type.price)} · ${availableQuantity(event, type)} dispo.</option>`).join("") : "";
  updatePosTotal();
}

function updatePosTotal() {
  const event = findEvent(document.querySelector("#pos-event").value);
  const type = findTicketType(event, document.querySelector("#pos-type").value);
  const quantity = Number(document.querySelector("#pos-form").elements.quantity.value || 0);
  document.querySelector("#pos-total").textContent = type && quantity > 0 ? money(type.price * quantity) : "— FCFA";
}

function paymentLabel(method) {
  return ({ orange: "Orange Money", mtn: "MTN MoMo", cash: "Espèces" })[method] || "Non précisé";
}

function renderReports() {
  const eventFilter = document.querySelector("#report-event");
  const chosenEvent = eventFilter.value || "all";
  eventFilter.innerHTML = `<option value="all">Tous les événements</option>${state.events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.title)}</option>`).join("")}`;
  eventFilter.value = state.events.some((event) => event.id === chosenEvent) || chosenEvent === "all" ? chosenEvent : "all";
  const vendorFilter = document.querySelector("#report-vendor");
  const chosenVendor = vendorFilter.value || "all";
  const vendors = [...new Set(confirmedOrders().map((order) => order.vendor))];
  vendorFilter.innerHTML = `<option value="all">Tous les vendeurs</option>${vendors.map((vendor) => `<option value="${escapeHtml(vendor)}">${escapeHtml(vendor)}</option>`).join("")}`;
  vendorFilter.value = vendors.includes(chosenVendor) || chosenVendor === "all" ? chosenVendor : "all";
  const method = document.querySelector("#report-payment").value;
  const filteredOrders = confirmedOrders().filter((order) =>
    (eventFilter.value === "all" || order.items.some((item) => item.eventId === eventFilter.value)) &&
    (vendorFilter.value === "all" || order.vendor === vendorFilter.value) &&
    (method === "all" || order.paymentMethod === method)
  );
  const tickets = filteredOrders.reduce((sum, order) => sum + order.tickets.length, 0);
  const entries = filteredOrders.reduce((sum, order) => sum + order.tickets.filter((ticket) => ticket.status === "used").length, 0);
  document.querySelector("#report-stats").innerHTML = [
    { label: "Ventes confirmées", value: filteredOrders.length, note: "commandes encaissées" },
    { label: "Billets émis", value: tickets, note: "par place" },
    { label: "Entrées", value: entries, note: "scans uniques" },
    { label: "Chiffre d’affaires démo", value: money(totalRevenue(filteredOrders)), note: "transactions simulées" }
  ].map((stat) => `<article class="stat-card"><span class="stat-icon">↗</span><span class="stat-label">${stat.label}</span><strong>${stat.value}</strong><span class="stat-note">${stat.note}</span></article>`).join("");
  const rows = filteredOrders.flatMap((order) => order.items.map((item) => {
    const event = findEvent(item.eventId), type = findTicketType(event, item.typeId);
    return `<tr><td>${escapeHtml(event?.title || "Événement supprimé")}</td><td>${escapeHtml(type?.name || "Catégorie archivée")}</td><td>${item.quantity}</td><td>${escapeHtml(order.vendor)}</td><td>${escapeHtml(paymentLabel(order.paymentMethod))}</td><td>${money(item.quantity * item.price)}</td></tr>`;
  }));
  document.querySelector("#report-rows").innerHTML = rows.length ? rows.join("") : '<tr><td class="table-empty" colspan="6">Aucune vente confirmée pour ces filtres.</td></tr>';
}

function renderMyTickets() {
  const orders = confirmedOrders().filter((order) => order.source === "web").sort((a, b) => b.createdAt - a.createdAt);
  const tickets = orders.flatMap((order) => ticketsInOrder(order).map((ticket) => ({ ...ticket, orderId: order.id })));
  document.querySelector("#my-tickets-list").innerHTML = tickets.length
    ? `<div class="notice notice-info">Billets de démonstration associés aux réservations locales de cet appareil. Aucun compte client sécurisé n’est connecté.</div><div class="my-ticket-grid">${tickets.map((ticket) => `<article class="my-ticket-card"><div class="qr-code">${qrCodeSvg(ticket.token)}</div><div><div class="section-kicker">${escapeHtml(ticket.typeName)} · ${money(ticket.price)}</div><h2>${escapeHtml(ticket.eventTitle)}</h2><p>Commande ${escapeHtml(ticket.orderId)}</p><code>${escapeHtml(ticket.token)}</code><span class="ticket-validity ${ticket.status === "used" ? "used" : ""}">${ticket.status === "used" ? "Entrée déjà utilisée" : "Billet valide · démo"}</span></div></article>`).join("")}</div>`
    : '<div class="empty-state"><span class="empty-state-icon">▣</span><h3>Aucun billet pour le moment.</h3><p>Choisis un événement et termine une réservation de démonstration.</p><button class="primary-button" data-go="events">Voir les événements <span>↗</span></button></div>';
}

function renderDemoTokens() {
  const tickets = confirmedOrders().flatMap((order) => ticketsInOrder(order));
  document.querySelector("#demo-token-list").innerHTML = tickets.length
    ? `<div class="token-list-heading">Jetons créés sur cet appareil</div>${tickets.slice(-6).map((ticket) => `<button class="token-sample" type="button" data-scan-token="${escapeHtml(ticket.token)}"><code>${escapeHtml(ticket.token)}</code><span>${escapeHtml(ticket.eventTitle)} · ${escapeHtml(ticket.status === "used" ? "déjà scanné" : "tester le scan")}</span></button>`).join("")}`
    : '<div class="empty-state compact">Crée un billet via une réservation confirmée ou une vente au point de vente pour tester le scanner.</div>';
}

function validateTicket(token, offline) {
  const result = document.querySelector("#scan-result");
  if (offline) {
    result.className = "scan-result result-gray";
    result.innerHTML = '<span class="result-icon">⌁</span><div><strong>Hors ligne · validation impossible</strong><p>Aucun billet n’a été marqué comme valide. Reconnecte-toi puis relance le scan.</p></div>';
    return;
  }
  const ticket = confirmedOrders().flatMap((order) => ticketsInOrder(order)).find((item) => item.token === token);
  if (!ticket) {
    result.className = "scan-result result-red";
    result.innerHTML = '<span class="result-icon">!</span><div><strong>Billet invalide</strong><p>Jeton inconnu ou commande non confirmée. Aucune entrée autorisée.</p></div>';
    return;
  }
  if (ticket.status === "used") {
    result.className = "scan-result result-orange";
    result.innerHTML = `<span class="result-icon">↻</span><div><strong>Billet déjà utilisé</strong><p>${escapeHtml(ticket.eventTitle)} · première entrée ${escapeHtml(dateLabel(ticket.checkedInAt, true))}.</p></div>`;
    return;
  }
  ticket.status = "used";
  ticket.checkedInAt = Date.now();
  persist();
  result.className = "scan-result result-green";
  result.innerHTML = `<span class="result-icon">✓</span><div><strong>Entrée valide · bienvenue !</strong><p>${escapeHtml(ticket.eventTitle)} · ${escapeHtml(ticket.typeName)} · ${escapeHtml(ticket.token)}</p></div>`;
  renderDemoTokens();
  renderDashboard();
  renderReports();
}

function createEventFromForm(form) {
  const data = new FormData(form);
  const eventId = String(data.get("eventId"));
  const previous = findEvent(eventId);
  const typeId = previous?.ticketTypes[0]?.id ?? "standard";
  const type = {
    id: typeId,
    name: String(data.get("ticketName")),
    price: Number(data.get("price")),
    quota: Number(data.get("quota")),
    sold: previous?.ticketTypes[0]?.sold ?? 0
  };
  if (type.quota < type.sold) {
    showToast(`Le quota ne peut pas être inférieur aux ${type.sold} billets déjà vendus.`);
    return;
  }
  const record = {
    ...(previous || {}),
    id: previous?.id || createReference("EVT").toLowerCase(),
    title: String(data.get("title")).trim(),
    category: String(data.get("category")),
    city: String(data.get("city")).trim(),
    date: new Date(String(data.get("date"))).toISOString(),
    description: String(data.get("description")).trim(),
    art: previous?.art || "concert",
    artLabel: previous?.artLabel || String(data.get("title")).trim().slice(0, 12).toUpperCase(),
    status: previous?.status || "draft",
    ticketTypes: previous ? [type, ...previous.ticketTypes.slice(1)] : [type]
  };
  if (previous) state.events = state.events.map((event) => event.id === previous.id ? record : event);
  else state.events.unshift(record);
  persist();
  closePanels();
  renderAdminEvents();
  renderEvents();
  showToast(previous ? "Événement mis à jour." : "Événement créé en brouillon.");
}

function setEventStatus(eventId, status) {
  const event = findEvent(eventId);
  if (!event) return;
  event.status = status;
  persist();
  renderAdminEvents();
  renderEvents();
  updateNavigation();
  showToast(`Statut « ${status} » enregistré.`);
}

function duplicateEvent(eventId) {
  const event = findEvent(eventId);
  if (!event) return;
  const duplicate = structuredClone(event);
  duplicate.id = createReference("EVT").toLowerCase();
  duplicate.title = `${event.title} (copie)`;
  duplicate.status = "draft";
  duplicate.ticketTypes = duplicate.ticketTypes.map((type) => ({ ...type, id: createReference("CAT").toLowerCase(), sold: 0 }));
  state.events.unshift(duplicate);
  persist();
  renderAdminEvents();
  showToast("Copie créée en brouillon.");
}

function confirmPointOfSale(form) {
  const data = new FormData(form);
  const event = findEvent(String(data.get("eventId")));
  const type = findTicketType(event, String(data.get("typeId")));
  const quantity = Number(data.get("quantity"));
  const payment = String(data.get("payment"));
  if (!event || !type || quantity < 1 || quantity > availableQuantity(event, type)) {
    showToast("Quota insuffisant pour cette vente.");
    return;
  }
  const operatorRef = String(data.get("operatorRef")).trim();
  if (payment !== "cash" && !operatorRef) {
    form.elements.operatorRef.setCustomValidity("Ajoute une référence de paiement démo pour le rapprochement.");
    form.elements.operatorRef.reportValidity();
    form.elements.operatorRef.setCustomValidity("");
    return;
  }
  const order = {
    id: createReference("POS"),
    name: "Vente comptoir",
    email: "",
    phone: "",
    operatorRef,
    items: [{ eventId: event.id, typeId: type.id, quantity, price: type.price }],
    total: type.price * quantity,
    status: "confirmed",
    source: "pos",
    paymentMethod: payment,
    vendor: "Point de vente",
    createdAt: Date.now(),
    confirmedAt: Date.now(),
    tickets: []
  };
  finalizeOrder(order, payment, "pos", "Point de vente");
  state.orders.push(order);
  persist();
  form.reset();
  form.elements.quantity.value = "1";
  renderPointOfSale();
  renderEvents();
  renderDashboard();
  renderReports();
  renderDemoTokens();
  showToast(`Vente démo enregistrée : ${order.id}.`);
  showIssuedTickets(order, "VENTE SUR PLACE · DÉMO");
}

function exportReport() {
  const rows = [["Événement", "Catégorie", "Billets", "Vendeur", "Paiement", "Montant FCFA", "Entrées validées"]];
  for (const order of confirmedOrders()) for (const item of order.items) {
    const event = findEvent(item.eventId), type = findTicketType(event, item.typeId);
    const used = ticketsInOrder(order).filter((ticket) => ticket.eventId === item.eventId && ticket.typeName === type?.name && ticket.status === "used").length;
    rows.push([event?.title || "", type?.name || "", item.quantity, order.vendor, paymentLabel(order.paymentMethod), item.quantity * item.price, used]);
  }
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "rftc-rapport-demo.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function showStorageNotice() {
  if (!storageAvailable) {
    showToast("Attention : stockage local indisponible. Recharge la page après avoir vérifié le navigateur.");
  }
}

elements.nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-go]");
  if (button) goToPage(button.dataset.go);
});
document.addEventListener("click", (event) => {
  const pageLink = event.target.closest("[data-page-link]");
  if (pageLink) { event.preventDefault(); goToPage(pageLink.dataset.pageLink); return; }
  const go = event.target.closest("[data-go]");
  if (go && !elements.nav.contains(go)) { goToPage(go.dataset.go); return; }
  const token = event.target.closest("[data-scan-token]");
  if (token) {
    document.querySelector("#scan-token").value = token.dataset.scanToken;
    validateTicket(token.dataset.scanToken, document.querySelector("#scanner-offline").checked);
  }
});

elements.role.addEventListener("change", () => {
  state.role = elements.role.value;
  persist();
  activePage = state.role === "agent" ? "scanner" : state.role === "vendor" ? "pos" : state.role === "organizer" || state.role === "admin" ? "dashboard" : state.role === "client" ? "events" : "events";
  updateNavigation();
});
elements.events.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) openTicketChoice(button.dataset.add);
});
elements.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (button) renderEvents(button.dataset.filter);
});
document.querySelector("#cart-items").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) { cart.delete(button.dataset.remove); renderCart(); renderEvents(); }
});
document.querySelector("#open-cart").addEventListener("click", openCart);
document.querySelector("#close-cart").addEventListener("click", closePanels);
elements.overlay.addEventListener("click", closePanels);
document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closePanels));
document.querySelector("#checkout-button").addEventListener("click", openCheckout);
document.querySelector("#ticket-choice-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  addToCart(selectedEventId, String(data.get("typeId")), Number(data.get("quantity")));
});
document.querySelector("#choice-type").addEventListener("change", updateChoiceAvailability);
document.querySelector("#ticket-choice-form [name=quantity]").addEventListener("input", updateChoiceAvailability);
document.querySelector("#checkout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.currentTarget.reportValidity()) createPendingOrder(event.currentTarget);
});
document.querySelector("#simulate-payment-success").addEventListener("click", () => completeDemoPayment(true));
document.querySelector("#simulate-payment-failure").addEventListener("click", () => completeDemoPayment(false));
document.querySelector("#print-tickets").addEventListener("click", () => window.print());
document.querySelector("#new-event-button").addEventListener("click", () => openEventForm());
document.querySelector("#event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.currentTarget.reportValidity()) createEventFromForm(event.currentTarget);
});
document.querySelector("#admin-event-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-action]");
  if (!button) return;
  const selected = findEvent(button.dataset.eventId);
  if (!selected) return;
  if (button.dataset.eventAction === "edit") openEventForm(selected);
  if (button.dataset.eventAction === "duplicate") duplicateEvent(selected.id);
  if (button.dataset.eventAction === "status") setEventStatus(selected.id, selected.status === "published" ? "draft" : "published");
  if (button.dataset.eventAction === "cancel" && window.confirm(`Clôturer « ${selected.title} » ?`)) setEventStatus(selected.id, "cancelled");
});
document.querySelector("#pos-event").addEventListener("change", updatePosTicketTypes);
document.querySelector("#pos-type").addEventListener("change", updatePosTotal);
document.querySelector("#pos-form").elements.quantity.addEventListener("input", updatePosTotal);
document.querySelector("#pos-form").elements.payment.addEventListener("change", (event) => {
  const reference = document.querySelector("#pos-form").elements.operatorRef;
  reference.required = event.target.value !== "cash";
  reference.placeholder = reference.required ? "Référence démo requise" : "Optionnelle pour espèces";
});
document.querySelector("#pos-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.currentTarget.reportValidity()) confirmPointOfSale(event.currentTarget);
});
document.querySelector("#scan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  validateTicket(String(new FormData(event.currentTarget).get("token")).trim(), document.querySelector("#scanner-offline").checked);
});
document.querySelector("#report-event").addEventListener("change", renderReports);
document.querySelector("#report-vendor").addEventListener("change", renderReports);
document.querySelector("#report-payment").addEventListener("change", renderReports);
document.querySelector("#export-report").addEventListener("click", exportReport);
document.querySelector("#reset-demo").addEventListener("click", () => {
  if (!window.confirm("Effacer les ventes, billets et modifications de cette démo sur cet appareil ?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = freshState();
  cart.clear();
  activeOrderId = null;
  activePage = "events";
  persist();
  renderEvents();
  renderCart();
  updateNavigation();
  closePanels();
  showToast("La démo a été réinitialisée.");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.overlay.hidden) closePanels();
});

try {
  if (!roles[state.role]) state.role = "visitor";
  expirePendingOrders();
  renderEvents();
  renderCart();
  updateNavigation();
  showStorageNotice();
} catch (error) {
  console.error("Erreur d’initialisation du prototype :", error);
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<div class="notice notice-error">${escapeHtml(error.message)}</div>`);
}
