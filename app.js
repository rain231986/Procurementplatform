import {
  availableInventory,
  calculatePurchaseSuggestion,
  calculateReplenishment,
  createId,
  demandOutstanding,
  demandUnallocated,
  formatMoney,
  isoDate,
  isOpenDemandStatus,
  numberLabel,
  purchaseCoverage,
  toNumber,
} from "./domain.js";

const STORAGE_KEY = "pharmacy-demand-platform.phase1.v1";
const SESSION_KEY = "pharmacy-demand-platform.session.v1";
const today = "2026-07-22";

const ROLE_LABELS = {
  ADMIN: "系統管理者",
  STORE: "門市",
  WAREHOUSE: "總倉",
  PURCHASING: "集中採購",
};

const STATUS_LABELS = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  APPROVED: "已核准",
  PROCESSING: "處理中",
  PARTIALLY_ALLOCATED: "部分配貨",
  WAITING_PURCHASE: "待集中採購",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  PENDING: "待確認",
  ACCEPTED: "已接受",
  SKIPPED: "暫不補貨",
  PICKING: "揀貨中",
  SHIPPED: "已出貨",
  RECEIVED: "已簽收",
  ORDERED: "已下單",
  PARTIALLY_RECEIVED: "部分到貨",
};

const VIEW_META = {
  dashboard: { title: "營運總覽", subtitle: "掌握門市需求、總倉庫存與集中採購進度" },
  demands: { title: "門市需求池", subtitle: "人工需求與門市確認後的自動補貨，統一在這裡追蹤" },
  replenishment: { title: "自動補貨建議", subtitle: "依門市補貨參數計算可落地的建議數量" },
  allocations: { title: "總倉配貨作業", subtitle: "依可用庫存部分或全部配貨，缺口自動流入採購" },
  purchasing: { title: "集中採購", subtitle: "彙總跨門市缺口，依主要供應商與採購倍數建立採購單" },
  receipts: { title: "到貨與門市簽收", subtitle: "先登記總倉到貨，再由總倉出貨、門市完成簽收" },
  masters: { title: "主檔與庫存", subtitle: "管理商品、供應商、門市補貨參數與測試庫存" },
  users: { title: "使用者管理", subtitle: "管理 Phase 1 登入帳號、角色與所屬單位" },
  audit: { title: "操作紀錄", subtitle: "追蹤需求、配貨、採購與庫存的重要異動" },
};

const state = {
  data: loadData(),
  session: loadSession(),
  view: "dashboard",
  filters: {},
  modal: null,
  toast: null,
};

document.addEventListener("DOMContentLoaded", () => {
  bindGlobalEvents();
  render();
});

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.version === 1) return saved;
  } catch (error) {
    console.warn("Unable to read demo data", error);
  }
  return seedData();
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function seedData() {
  const locations = [
    { id: "store01", code: "STORE01", name: "民生門市", type: "STORE", address: "台北市松山區民生東路" },
    { id: "store02", code: "STORE02", name: "中山門市", type: "STORE", address: "台北市中山區南京東路" },
    { id: "store03", code: "STORE03", name: "板橋門市", type: "STORE", address: "新北市板橋區文化路" },
    { id: "store04", code: "STORE04", name: "台中門市", type: "STORE", address: "台中市西區公益路" },
    { id: "store05", code: "STORE05", name: "高雄門市", type: "STORE", address: "高雄市左營區博愛路" },
    { id: "warehouse", code: "WH01", name: "中央總倉", type: "WAREHOUSE", address: "桃園市蘆竹區物流園區" },
  ];
  const suppliers = [
    { id: "sup01", code: "SUP-001", name: "康健醫藥股份有限公司", contact: "王小姐", phone: "02-2211-7788", leadTimeDays: 3 },
    { id: "sup02", code: "SUP-002", name: "安泰藥品有限公司", contact: "林先生", phone: "04-2312-8899", leadTimeDays: 5 },
    { id: "sup03", code: "SUP-003", name: "日新保健有限公司", contact: "陳小姐", phone: "07-558-1033", leadTimeDays: 7 },
  ];
  const productNames = [
    ["舒敏感冒膠囊", "24粒/盒", "一般藥品"], ["兒童退燒糖漿", "60ml/瓶", "兒童用藥"],
    ["高單位維他命D", "60錠/瓶", "保健食品"], ["速效感冒錠", "20錠/盒", "一般藥品"],
    ["兒童舒熱懸液", "60ml/瓶", "兒童用藥"], ["護眼葉黃素膠囊", "30粒/盒", "保健食品"],
    ["成人綜合維他命", "90錠/瓶", "保健食品"], ["口罩醫療用", "50片/盒", "醫療用品"],
    ["酒精棉片", "100片/盒", "醫療用品"], ["抗菌洗手乳", "500ml/瓶", "日用品"],
    ["維生素C發泡錠", "20錠/管", "保健食品"], ["關節保養錠", "60錠/瓶", "保健食品"],
    ["血壓計標準型", "1台/盒", "醫療器材"], ["冰涼退熱貼", "6片/盒", "日用品"],
    ["紗布繃帶組", "10入/盒", "醫療用品"], ["鼻炎噴劑", "15ml/瓶", "一般藥品"],
    ["腸胃舒緩錠", "30錠/盒", "一般藥品"], ["護唇修護膏", "4g/條", "日用品"],
    ["成人口罩立體型", "30片/盒", "醫療用品"], ["鈣鎂鋅錠", "90錠/瓶", "保健食品"],
  ];
  const products = productNames.map(([name, specification, category], index) => ({
    id: `product${String(index + 1).padStart(2, "0")}`,
    productCode: `PH-${String(index + 1).padStart(4, "0")}`,
    barcode: `4710001${String(index + 1).padStart(6, "0")}`,
    name,
    specification,
    category,
    baseUnit: specification.split("/")[1] || "件",
    supplierId: `sup${String((index % 3) + 1).padStart(2, "0")}`,
    isActive: true,
  }));
  const supplierProducts = products.map((product, index) => ({
    id: `sp${String(index + 1).padStart(2, "0")}`,
    productId: product.id,
    supplierId: product.supplierId,
    supplierProductCode: `${product.productCode}-S`,
    purchaseUnit: product.baseUnit,
    purchaseMultiple: index % 3 === 0 ? 12 : index % 3 === 1 ? 6 : 1,
    minimumOrderQuantity: index % 4 === 0 ? 24 : 12,
    purchasePrice: 80 + index * 7,
    isPrimary: true,
  }));
  const settings = [];
  const inventory = [];
  locations.forEach((location, locationIndex) => {
    products.forEach((product, productIndex) => {
      if (location.type === "STORE") {
        settings.push({
          id: `setting_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          safetyStockQty: productIndex % 4 === 0 ? 12 : 8,
          maximumStockQty: productIndex % 4 === 0 ? 36 : 24,
          minimumReplenishmentQty: productIndex % 3 === 0 ? 6 : 4,
          storeDistributionMultiple: productIndex % 3 === 0 ? 3 : 1,
          automaticReplenishmentEnabled: productIndex < 12,
        });
        const lowStock = productIndex === 0 || productIndex === 5;
        inventory.push({
          id: `balance_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          onHandQty: lowStock ? (locationIndex % 2) : 10 + ((locationIndex + productIndex) % 14),
          reservedQty: lowStock ? 1 : (productIndex % 7 === 0 ? 2 : 0),
          updatedAt: today,
        });
      } else {
        inventory.push({
          id: `balance_${location.id}_${product.id}`,
          locationId: location.id,
          productId: product.id,
          onHandQty: productIndex === 0 ? 12 : productIndex === 5 ? 8 : 36 + ((productIndex * 5) % 48),
          reservedQty: productIndex % 6 === 0 ? 6 : 0,
          updatedAt: today,
        });
      }
    });
  });
  const users = [
    { id: "user_admin", username: "admin", displayName: "系統管理者", role: "ADMIN", locationId: null, isActive: true, passwordHash: "" },
    ...locations.filter((location) => location.type === "STORE").map((location) => ({
      id: `user_${location.id}`, username: location.id, displayName: `${location.name} 店長`, role: "STORE", locationId: location.id, isActive: true, passwordHash: "",
    })),
    { id: "user_warehouse", username: "warehouse01", displayName: "總倉作業員", role: "WAREHOUSE", locationId: "warehouse", isActive: true, passwordHash: "" },
    { id: "user_buyer", username: "buyer01", displayName: "集中採購專員", role: "PURCHASING", locationId: null, isActive: true, passwordHash: "" },
  ];
  const demands = [
    {
      id: "demand_demo_01", demandNumber: "DN-202607-001", locationId: "store01", sourceType: "MANUAL", demandType: "URGENT", requiredDate: "2026-07-24", status: "SUBMITTED", notes: "流感季急件，請優先處理。", createdBy: "user_store01", createdAt: "2026-07-21 09:18", submittedAt: "2026-07-21 09:22",
      items: [{ id: "ditem_01", productId: "product01", requestedQty: 24, approvedQty: 24, allocatedQty: 12, purchaseRequiredQty: 12, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason: "近期客人詢問增加", notes: "" }],
    },
    {
      id: "demand_demo_02", demandNumber: "DN-202607-002", locationId: "store03", sourceType: "AUTO", demandType: "GENERAL", requiredDate: "2026-07-28", status: "APPROVED", notes: "由自動補貨建議轉入。", createdBy: "user_store03", createdAt: "2026-07-20 14:05", submittedAt: "2026-07-20 14:06",
      items: [{ id: "ditem_02", productId: "product06", requestedQty: 18, approvedQty: 18, allocatedQty: 0, purchaseRequiredQty: 18, purchaseOrderedQty: 18, purchaseReceivedQty: 0, receivedQty: 0, reason: "安全庫存觸發", notes: "" }],
    },
    {
      id: "demand_demo_03", demandNumber: "DN-202607-003", locationId: "store02", sourceType: "MANUAL", demandType: "CUSTOMER_ORDER", requiredDate: "2026-07-23", status: "COMPLETED", notes: "客訂已於今日完成簽收。", createdBy: "user_store02", createdAt: "2026-07-18 11:30", submittedAt: "2026-07-18 11:31",
      items: [{ id: "ditem_03", productId: "product03", requestedQty: 12, approvedQty: 12, allocatedQty: 12, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 12, reason: "客戶預訂", notes: "" }],
    },
    {
      id: "demand_demo_04", demandNumber: "DN-202607-004", locationId: "store04", sourceType: "MANUAL", demandType: "PROMOTION", requiredDate: "2026-07-31", status: "DRAFT", notes: "週末健康檢測活動備貨。", createdBy: "user_store04", createdAt: "2026-07-22 08:46", submittedAt: null,
      items: [{ id: "ditem_04", productId: "product11", requestedQty: 30, approvedQty: 0, allocatedQty: 0, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason: "活動備貨", notes: "" }],
    },
  ];
  const allocations = [
    { id: "allocation_demo_01", allocationNumber: "AL-202607-001", sourceLocationId: "warehouse", destinationLocationId: "store01", demandOrderId: "demand_demo_01", status: "SHIPPED", shippedAt: "2026-07-21 16:10", receivedAt: null, createdBy: "user_warehouse", createdAt: "2026-07-21 15:44", items: [{ id: "aitem_01", productId: "product01", requestedQty: 24, allocatedQty: 12, shippedQty: 12, receivedQty: 0 }] },
  ];
  const purchaseOrders = [
    { id: "po_demo_01", purchaseOrderNumber: "PO-202607-001", supplierId: "sup03", orderDate: "2026-07-20", expectedDeliveryDate: "2026-07-27", status: "PARTIALLY_RECEIVED", notes: "集中採購：葉黃素缺口", createdBy: "user_buyer", createdAt: "2026-07-20 15:20", lines: [{ id: "poline_01", productId: "product06", orderedQty: 24, purchasePrice: 115, receivedQty: 0, sourceDemandIds: ["demand_demo_02"] }] },
  ];
  return {
    version: 1,
    locations,
    suppliers,
    products,
    supplierProducts,
    settings,
    inventory,
    users,
    demands,
    replenishmentSuggestions: [],
    allocations,
    purchaseSuggestions: [],
    purchaseOrders,
    auditLogs: [
      { id: "audit_01", createdAt: "2026-07-22 08:40", userId: "user_admin", action: "登入", entityType: "SESSION", entityId: "user_admin", detail: "系統管理者登入示範環境" },
      { id: "audit_02", createdAt: "2026-07-21 16:10", userId: "user_warehouse", action: "配貨出貨", entityType: "ALLOCATION", entityId: "allocation_demo_01", detail: "AL-202607-001 已出貨 12 盒" },
      { id: "audit_03", createdAt: "2026-07-20 15:20", userId: "user_buyer", action: "建立採購單", entityType: "PURCHASE_ORDER", entityId: "po_demo_01", detail: "PO-202607-001，日新保健，24 盒" },
    ],
  };
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    event.preventDefault();
    handleAction(actionTarget.dataset.action, actionTarget.dataset);
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id === "loginForm") {
      event.preventDefault();
      handleLogin(new FormData(event.target));
    }
    if (event.target.id === "setupPasswordForm") {
      event.preventDefault();
      handlePasswordSetup(new FormData(event.target));
    }
    if (event.target.id === "entityForm") {
      event.preventDefault();
      handleModalSubmit(new FormData(event.target));
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-filter-key]")) {
      state.filters[event.target.dataset.filterKey] = event.target.value;
      renderContent();
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-filter-key]")) {
      state.filters[event.target.dataset.filterKey] = event.target.value;
      renderContent();
    }
  });
  window.addEventListener("storage", () => {
    state.data = loadData();
    state.session = loadSession();
    render();
  });
}

function handleAction(action, data = {}) {
  switch (action) {
    case "navigate":
      state.view = data.view || "dashboard";
      state.filters = {};
      render();
      break;
    case "logout":
      writeSession(null);
      state.session = null;
      state.view = "dashboard";
      render();
      break;
    case "reset-demo":
      if (window.confirm("確定要重設本機示範資料嗎？所有新增需求、配貨與採購異動都會清除。")) {
        state.data = seedData();
        saveData();
        showToast("示範資料已重設", "success");
        render();
      }
      break;
    case "open-create-demand":
      openModal("create-demand");
      break;
    case "submit-demand":
      submitDemand(data.id);
      break;
    case "approve-demand":
      approveDemand(data.id);
      break;
    case "open-demand":
      openModal("demand-detail", { demandId: data.id });
      break;
    case "run-replenishment":
      runReplenishment(data.scope || "mine");
      break;
    case "convert-suggestion":
      openModal("confirm-suggestion", { suggestionId: data.id });
      break;
    case "skip-suggestion":
      updateSuggestion(data.id, { status: "SKIPPED" }, "暫不補貨");
      break;
    case "open-allocation":
      openModal("allocation", { demandId: data.id });
      break;
    case "create-allocation":
      createAllocation(data.id, data.mode || "available");
      break;
    case "ship-allocation":
      shipAllocation(data.id);
      break;
    case "open-receive-allocation":
      openModal("receive-allocation", { allocationId: data.id });
      break;
    case "generate-purchase":
      generatePurchaseSuggestions();
      break;
    case "create-purchase-order":
      createPurchaseOrder(data.id);
      break;
    case "open-receive-po":
      openModal("receive-purchase", { purchaseOrderId: data.id });
      break;
    case "open-add-product":
      openModal("add-product");
      break;
    case "open-adjust-inventory":
      openModal("adjust-inventory", { locationId: data.locationId, productId: data.productId });
      break;
    case "open-add-user":
      openModal("add-user");
      break;
    case "toggle-user":
      toggleUser(data.id);
      break;
    case "open-profile":
      openModal("profile");
      break;
    case "close-modal":
      closeModal();
      break;
    default:
      break;
  }
}

async function handlePasswordSetup(formData) {
  const password = String(formData.get("setupPassword") || "");
  const confirmPassword = String(formData.get("setupPasswordConfirm") || "");
  if (password.length < 6) return showToast("示範密碼至少需要 6 個字元", "error");
  if (password !== confirmPassword) return showToast("兩次輸入的密碼不一致", "error");
  const hash = await hashPassword(password);
  state.data.users = state.data.users.map((user) => ({ ...user, passwordHash: hash }));
  saveData();
  showToast("本機示範密碼已設定，請使用帳號登入", "success");
  render();
}

async function handleLogin(formData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const user = state.data.users.find((item) => item.username === username);
  if (!user || !user.isActive) return showToast("帳號不存在或已停用", "error");
  if (!user.passwordHash) return showToast("請先在左側設定本機示範密碼", "error");
  const hash = await hashPassword(password);
  if (hash !== user.passwordHash) return showToast("帳號或密碼錯誤", "error");
  user.lastLoginAt = `${today} 09:00`;
  addAudit("登入", "SESSION", user.id, `${user.displayName} 登入平台`);
  state.session = { userId: user.id, signedInAt: Date.now() };
  writeSession(state.session);
  state.view = "dashboard";
  showToast(`歡迎回來，${user.displayName}`, "success");
  render();
}

async function hashPassword(value) {
  if (window.crypto?.subtle) {
    const buffer = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Array.from(value).reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0).toString(16);
}

function writeSession(session) {
  state.session = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function render() {
  const root = document.getElementById("appRoot");
  if (!state.session) {
    root.innerHTML = renderLogin();
    return;
  }
  const user = currentUser();
  if (!user || !user.isActive) {
    writeSession(null);
    root.innerHTML = renderLogin();
    return;
  }
  root.innerHTML = renderShell(user);
  renderContent();
  if (state.toast) {
    window.setTimeout(() => {
      state.toast = null;
      const toast = document.querySelector(".toast");
      toast?.remove();
    }, 2600);
  }
}

function renderLogin() {
  const hasPassword = state.data.users.some((user) => user.passwordHash);
  return `<div class="login-page">
    <section class="login-visual">
      <div class="brand-lockup"><span class="brand-mark large">藥</span><div><span class="brand-name">PharmaFlow</span><span class="brand-caption">供應協作平台 · Phase 1</span></div></div>
      <div class="login-message"><span class="section-kicker">PHARMACY SUPPLY CONTROL</span><h1>讓每一個缺口，<br><em>都有下一步。</em></h1><p>從門市需求、總倉配貨到集中採購，用同一條流程追蹤供應進度。</p></div>
      <div class="login-flow"><div><b>01</b><span>門市提需求</span></div><i>→</i><div><b>02</b><span>總倉配貨</span></div><i>→</i><div><b>03</b><span>採購補缺口</span></div></div>
      <p class="login-note">本版本為流程驗證工具，資料僅儲存在此瀏覽器。</p>
    </section>
    <section class="login-card-wrap">
      <div class="login-card">
        <div class="login-card-head"><span class="section-kicker">WELCOME BACK</span><h2>登入平台</h2><p>請使用 Phase 1 測試帳號進入工作台。</p></div>
        <form id="loginForm" class="form-stack">
          <label class="field"><span>帳號</span><select name="username" required>${state.data.users.map((user) => `<option value="${escapeHtml(user.username)}">${escapeHtml(user.username)} · ${escapeHtml(user.displayName)}</option>`).join("")}</select></label>
          <label class="field"><span>密碼</span><input name="password" type="password" autocomplete="current-password" placeholder="輸入本機示範密碼" required /></label>
          <button class="button primary full" type="submit">登入工作台 <span>↗</span></button>
        </form>
        ${!hasPassword ? `<div class="setup-box"><div><strong>首次使用</strong><p>先設定一組只保存在此瀏覽器的示範密碼。</p></div><form id="setupPasswordForm" class="setup-form"><input name="setupPassword" type="password" minlength="6" placeholder="設定至少 6 個字元" required /><input name="setupPasswordConfirm" type="password" minlength="6" placeholder="再次輸入" required /><button class="button secondary full" type="submit">建立本機登入密碼</button></form></div>` : `<div class="login-hint"><span class="status-dot green"></span>示範資料已就緒 · 帳號密碼由本機設定</div>`}
        <div class="demo-accounts"><span class="label">測試角色</span><div>${Object.entries(ROLE_LABELS).map(([role, label]) => `<span class="role-tag ${role.toLowerCase()}">${label}</span>`).join("")}</div></div>
      </div>
      <span class="login-footer">Taipei · Asia/Taipei · 內部流程驗證版</span>
    </section>
    ${state.toast ? renderToast() : ""}
  </div>`;
}

function renderShell(user) {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup"><span class="brand-mark">藥</span><div><span class="brand-name">PharmaFlow</span><span class="brand-caption">供應協作平台</span></div></div>
      <div class="workspace-switch"><span class="workspace-icon">⌘</span><div><span>目前工作區</span><strong>Phase 1 驗證環境</strong></div><span class="chevron">⌄</span></div>
      <nav class="side-nav"><span class="nav-label">工作台</span>${renderNavButton("dashboard", "總覽", "⌂")}${renderNavButton("demands", "門市需求池", "▤", demandCount())}${canView("replenishment") ? renderNavButton("replenishment", "自動補貨建議", "↻", pendingSuggestionCount()) : ""}${canView("allocations") ? renderNavButton("allocations", "總倉配貨作業", "⇥", allocationCount()) : ""}${canView("purchasing") ? renderNavButton("purchasing", "集中採購", "◫", purchaseGapCount()) : ""}${canView("receipts") ? renderNavButton("receipts", "到貨與簽收", "✓", receiptCount()) : ""}<span class="nav-label secondary">管理</span>${canView("masters") ? renderNavButton("masters", "主檔與庫存", "▦") : ""}${canView("users") ? renderNavButton("users", "使用者管理", "♙") : ""}${canView("audit") ? renderNavButton("audit", "操作紀錄", "◷") : ""}</nav>
      <div class="sidebar-bottom"><div class="health-card"><span class="status-dot green"></span><div><strong>系統運作正常</strong><span>本機資料儲存已啟用</span></div></div><button class="side-text-button" data-action="reset-demo">↺ 重設示範資料</button></div>
    </aside>
    <main class="main-content">
      <header class="topbar"><div class="breadcrumb"><span>PharmaFlow</span><b>/</b><strong>${escapeHtml(VIEW_META[state.view]?.title || VIEW_META.dashboard.title)}</strong></div><div class="top-actions"><button class="icon-button ghost" data-action="open-profile" aria-label="查看個人資訊">◉</button><button class="user-menu" data-action="open-profile"><span class="avatar ${user.role.toLowerCase()}">${escapeHtml(user.displayName.slice(0, 1))}</span><span class="user-text"><b>${escapeHtml(user.displayName)}</b><small>${ROLE_LABELS[user.role]}${user.locationId ? ` · ${locationName(user.locationId)}` : ""}</small></span><span class="chevron">⌄</span></button></div></header>
      <div id="pageContent"></div>
    </main>
    ${state.modal ? renderModal() : ""}
    ${state.toast ? renderToast() : ""}
  </div>`;
}

function renderNavButton(view, label, icon, count = 0) {
  return `<button class="nav-item ${state.view === view ? "active" : ""}" data-action="navigate" data-view="${view}"><span class="nav-icon">${icon}</span><span>${label}</span>${count ? `<em>${count}</em>` : ""}</button>`;
}

function renderContent() {
  const target = document.getElementById("pageContent");
  if (!target) return;
  target.innerHTML = `<div class="page-wrap">${state.view === "dashboard" ? renderDashboard() : state.view === "demands" ? renderDemands() : state.view === "replenishment" ? renderReplenishment() : state.view === "allocations" ? renderAllocations() : state.view === "purchasing" ? renderPurchasing() : state.view === "receipts" ? renderReceipts() : state.view === "masters" ? renderMasters() : state.view === "users" ? renderUsers() : renderAudit()}${state.toast ? renderToast() : ""}</div>`;
}

function renderPageIntro(eyebrow, title, description, actions = "") {
  return `<div class="page-intro"><div><span class="section-kicker">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}

function renderDashboard() {
  const user = currentUser();
  const demands = visibleDemands();
  const openDemands = demands.filter((demand) => !["COMPLETED", "CANCELLED"].includes(demand.status));
  const suggestions = visibleSuggestions().filter((item) => item.status === "PENDING");
  const allocations = visibleAllocations();
  const gap = purchaseGapCount();
  const roleFocus = user.role === "STORE" ? { kicker: "STORE CONTROL", title: `${locationName(user.locationId)}，今天先處理這些事`, desc: "需求進度與待簽收狀態集中在一個畫面，減少來回確認。" } : user.role === "WAREHOUSE" ? { kicker: "WAREHOUSE CONTROL", title: "把缺口變成下一張配貨單", desc: "先看全門市需求，再用總倉可用量決定全部或部分配貨。" } : user.role === "PURCHASING" ? { kicker: "PURCHASING CONTROL", title: "跨門市缺口，集中一次採購", desc: "依主要供應商、MOQ 與採購倍數彙總採購建議。" } : { kicker: "OPERATIONS CONTROL", title: "供應流程總覽", desc: "這裡是藥局門市、總倉與採購部門的共同作業入口。" };
  const metrics = user.role === "STORE" ? [
    metric("未完成需求", openDemands.length, "張", "blue", "demands"), metric("待確認補貨", suggestions.length, "筆", "violet", "replenishment"), metric("待簽收配貨", allocations.filter((item) => item.status === "SHIPPED").length, "張", "amber", "receipts"), metric("本月已完成", demands.filter((demand) => demand.status === "COMPLETED").length, "張", "green", "demands"),
  ] : user.role === "WAREHOUSE" ? [
    metric("待處理需求", openDemands.filter((item) => ["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(item.status)).length, "張", "blue", "allocations"), metric("待揀貨配貨", allocations.filter((item) => item.status === "PICKING").length, "張", "violet", "allocations"), metric("已出貨未簽收", allocations.filter((item) => item.status === "SHIPPED").length, "張", "amber", "receipts"), metric("待採購缺口", gap, "項", "red", "purchasing"),
  ] : user.role === "PURCHASING" ? [
    metric("待採購商品", gap, "項", "red", "purchasing"), metric("進行中採購單", state.data.purchaseOrders.filter((po) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)).length, "張", "blue", "purchasing"), metric("未到貨數量", pendingPurchaseQty(), "件", "amber", "receipts"), metric("本月已到貨", receivedPurchaseQty(), "件", "green", "receipts"),
  ] : [
    metric("未完成需求", openDemands.length, "張", "blue", "demands"), metric("待採購缺口", gap, "項", "red", "purchasing"), metric("總倉可用 SKU", warehouseSkuCount(), "項", "green", "masters"), metric("今日操作紀錄", state.data.auditLogs.filter((item) => item.createdAt.startsWith(today)).length, "筆", "violet", "audit"),
  ];
  const attention = buildAttentionItems(user);
  return `${renderPageIntro(roleFocus.kicker, roleFocus.title, roleFocus.desc, user.role === "STORE" ? button("open-create-demand", "＋ 新增人工需求", "primary") : user.role === "WAREHOUSE" ? button("navigate", "檢視待配貨", "primary", { view: "allocations" }) : user.role === "PURCHASING" ? button("generate-purchase", "↻ 更新採購建議", "primary") : button("navigate", "開啟需求池", "primary", { view: "demands" }))}
    <div class="metric-grid">${metrics.join("")}</div>
    <div class="dashboard-grid"><section class="panel focus-panel"><div class="panel-heading"><div><span class="section-kicker">NEXT ACTIONS</span><h2>今日工作焦點</h2></div><span class="live-chip"><i></i>即時摘要</span></div><div class="attention-list">${attention.map(renderAttentionItem).join("") || emptyState("目前沒有需要立即處理的事項", "系統會在需求、配貨或採購狀態變更時更新。")}</div></section><section class="panel flow-panel"><div class="panel-heading"><div><span class="section-kicker">PHASE 1 FLOW</span><h2>供應流程</h2></div><span class="progress-caption">${workflowProgress()}% 完成</span></div>${renderFlow()}</section></div>
    <div class="dashboard-grid lower"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">RECENT DEMANDS</span><h2>最近需求</h2></div><button class="text-button" data-action="navigate" data-view="demands">查看全部 →</button></div>${renderCompactDemandList(demands.slice(0, 4))}</section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">INVENTORY SIGNAL</span><h2>總倉庫存訊號</h2></div><button class="text-button" data-action="navigate" data-view="masters">查看庫存 →</button></div>${renderInventorySignals()}</section></div>`;
}

function metric(label, value, suffix, tone, view) {
  return `<button class="metric-card ${tone}" data-action="navigate" data-view="${view}"><span>${label}</span><strong>${numberLabel(value)}<small>${suffix}</small></strong><em>查看詳情 ↗</em></button>`;
}

function button(action, label, tone = "secondary", data = {}) {
  const attrs = Object.entries({ ...data, action }).map(([key, value]) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeHtml(value)}"`).join(" ");
  return `<button class="button ${tone}" ${attrs}>${label}</button>`;
}

function renderFlow() {
  const steps = [
    ["demand", "門市提需求", "人工或補貨建議"], ["allocate", "總倉判斷", "全部 / 部分配貨"], ["purchase", "集中採購", "補足總倉缺口"], ["receive", "到貨與簽收", "需求完成結案"],
  ];
  return `<div class="flow-list">${steps.map(([icon, title, detail], index) => `<div class="flow-step"><span class="flow-number">0${index + 1}</span><span class="flow-symbol ${icon}">${index === 0 ? "↗" : index === 1 ? "⇥" : index === 2 ? "◫" : "✓"}</span><div><strong>${title}</strong><small>${detail}</small></div>${index < steps.length - 1 ? `<i class="flow-line"></i>` : ""}</div>`).join("")}</div>`;
}

function renderDemands() {
  const user = currentUser();
  const search = String(state.filters.demandsSearch || "").toLowerCase();
  const status = state.filters.demandsStatus || "ALL";
  const demands = visibleDemands().filter((demand) => {
    const text = `${demand.demandNumber} ${locationName(demand.locationId)} ${demand.items.map((item) => productName(item.productId)).join(" ")}`.toLowerCase();
    return (!search || text.includes(search)) && (status === "ALL" || demand.status === status);
  });
  const actions = user.role === "STORE" || user.role === "ADMIN" ? button("open-create-demand", "＋ 新增人工需求", "primary") : "";
  return `${renderPageIntro("DEMAND WORKSPACE", "門市需求池", "人工需求與自動補貨建議轉單後，會在這裡形成同一個處理佇列。", actions)}
    <div class="summary-strip"><div><span>目前顯示</span><strong>${demands.length}<small> 張需求</small></strong></div><div><span>待總倉處理</span><strong class="blue-text">${visibleDemands().filter((item) => ["SUBMITTED", "APPROVED"].includes(item.status)).length}</strong></div><div><span>待採購缺口</span><strong class="red-text">${purchaseGapCount()}</strong></div><div><span>門市資料隔離</span><strong class="green-text">${user.role === "STORE" ? locationName(user.locationId) : "全域"}</strong></div></div>
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="demandsSearch" value="${escapeHtml(state.filters.demandsSearch || "")}" placeholder="搜尋需求單號、門市或商品" /></label><select data-filter-key="demandsStatus"><option value="ALL">全部狀態</option>${Object.entries(STATUS_LABELS).filter(([key]) => ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE", "COMPLETED"].includes(key)).map(([key, label]) => `<option value="${key}" ${status === key ? "selected" : ""}>${label}</option>`).join("")}</select><span class="toolbar-spacer"></span><span class="table-count">${demands.length} 筆</span></div><div class="table-wrap"><table><thead><tr><th>需求單</th><th>門市</th><th>來源 / 類型</th><th>需求日</th><th>明細</th><th>進度</th><th>操作</th></tr></thead><tbody>${demands.map(renderDemandRow).join("") || emptyRow(7, "目前沒有符合條件的需求")}</tbody></table></div></section>`;
}

function renderDemandRow(demand) {
  const user = currentUser();
  const total = demand.items.reduce((sum, item) => sum + toNumber(item.requestedQty), 0);
  const received = demand.items.reduce((sum, item) => sum + toNumber(item.receivedQty), 0);
  const buttons = [button("open-demand", "查看", "ghost small", { id: demand.id })];
  if (user.role === "STORE" && demand.status === "DRAFT") buttons.push(button("submit-demand", "送出", "primary small", { id: demand.id }));
  if (["ADMIN", "WAREHOUSE"].includes(user.role) && ["SUBMITTED", "DRAFT"].includes(demand.status)) buttons.push(button("approve-demand", "核准", "secondary small", { id: demand.id }));
  return `<tr><td><strong class="mono">${demand.demandNumber}</strong><small class="cell-sub">${demand.createdAt}</small></td><td><strong>${locationName(demand.locationId)}</strong><small class="cell-sub">${demand.createdBy === currentUser()?.id ? "由我建立" : "跨單位需求"}</small></td><td><span class="source-chip ${demand.sourceType.toLowerCase()}">${demand.sourceType === "AUTO" ? "自動補貨" : "人工需求"}</span><small class="cell-sub">${demandTypeLabel(demand.demandType)}</small></td><td><strong>${demand.requiredDate}</strong><small class="cell-sub">${demand.requiredDate < today ? "已逾期" : "交期"}</small></td><td><strong>${demand.items.length} 項 · ${numberLabel(total)} 件</strong><small class="cell-sub">已收 ${numberLabel(received)} 件</small></td><td>${statusChip(demand.status)}</td><td><div class="row-actions">${buttons.join("")}</div></td></tr>`;
}

function renderReplenishment() {
  const user = currentUser();
  const suggestions = visibleSuggestions().filter((item) => {
    const status = state.filters.replenishmentStatus || "ALL";
    const search = String(state.filters.replenishmentSearch || "").toLowerCase();
    const text = `${productName(item.productId)} ${locationName(item.locationId)} ${item.reason || ""}`.toLowerCase();
    return (status === "ALL" || item.status === status) && (!search || text.includes(search));
  });
  const actions = `${button("run-replenishment", user.role === "ADMIN" ? "↻ 執行全部門市計算" : "↻ 重新計算本門市", "primary", { scope: user.role === "ADMIN" ? "all" : "mine" })}`;
  return `${renderPageIntro("REPLENISHMENT ENGINE", "自動補貨建議", "建議先由門市確認，再轉為正式需求；系統不會直接產生採購單。", actions)}
    <div class="formula-callout"><div class="formula-icon">ƒx</div><div><strong>計算邏輯已依 Phase 1 規則執行</strong><span>預估可用 = 現有 − 保留 + 配貨在途 + 採購入庫 + 未完成需求；低於安全庫存時，向上調整至門市配貨倍數。</span></div><button class="text-button" data-action="navigate" data-view="audit">查看紀錄 →</button></div>
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="replenishmentSearch" value="${escapeHtml(state.filters.replenishmentSearch || "")}" placeholder="搜尋商品、門市或建議原因" /></label><select data-filter-key="replenishmentStatus"><option value="ALL">全部狀態</option>${["PENDING", "ACCEPTED", "SKIPPED"].map((key) => `<option value="${key}" ${(state.filters.replenishmentStatus || "ALL") === key ? "selected" : ""}>${STATUS_LABELS[key]}</option>`).join("")}</select><span class="toolbar-spacer"></span><span class="table-count">${suggestions.length} 筆</span></div><div class="table-wrap"><table><thead><tr><th>門市 / 商品</th><th>預估可用</th><th>安全 / 目標</th><th>系統建議</th><th>計算依據</th><th>狀態</th><th>操作</th></tr></thead><tbody>${suggestions.map(renderSuggestionRow).join("") || emptyRow(7, "尚未產生補貨建議，請先執行計算")}</tbody></table></div></section>`;
}

function renderSuggestionRow(suggestion) {
  const settings = getSetting(suggestion.locationId, suggestion.productId);
  const buttons = suggestion.status === "PENDING" ? [button("convert-suggestion", "確認轉需求", "primary small", { id: suggestion.id }), button("skip-suggestion", "暫不補貨", "ghost small", { id: suggestion.id })] : [button("open-demand", "查看來源", "ghost small", { id: suggestion.demandId || "" })];
  return `<tr><td><strong>${locationName(suggestion.locationId)}</strong><small class="cell-sub">${productCode(suggestion.productId)} · ${productName(suggestion.productId)}</small></td><td><strong class="big-cell">${numberLabel(suggestion.projectedAvailableQty)}</strong><small class="cell-sub">${suggestion.projectedAvailableQty <= settings.safetyStockQty ? "低於安全線" : "在安全線上"}</small></td><td><span>${numberLabel(settings.safetyStockQty)} / ${numberLabel(settings.maximumStockQty)}</span><small class="cell-sub">最低 ${numberLabel(settings.minimumReplenishmentQty)} · 倍數 ${numberLabel(settings.storeDistributionMultiple)}</small></td><td><strong class="accent-number">${numberLabel(suggestion.suggestedQty)}</strong><small class="cell-sub">原始 ${numberLabel(suggestion.rawRequiredQty)} · 基準 ${numberLabel(suggestion.baseSuggestedQty)}</small></td><td><span>${suggestion.reason || "安全庫存觸發"}</span><small class="cell-sub">計算時間 ${suggestion.createdAt}</small></td><td>${statusChip(suggestion.status)}</td><td><div class="row-actions">${buttons.join("")}</div></td></tr>`;
}

function renderAllocations() {
  const demands = visibleDemands().filter((demand) => ["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(demand.status));
  const allocationHistory = state.data.allocations.filter((item) => ["PICKING", "SHIPPED", "RECEIVED"].includes(item.status));
  return `${renderPageIntro("WAREHOUSE DESK", "總倉配貨作業", "依總倉可用庫存處理需求；建立配貨後才能揀貨與出貨。", `<span class="inline-stat"><b>${demands.length}</b> 待處理需求</span>`)}
    <div class="warehouse-hero"><div class="warehouse-hero-icon">⇥</div><div><span class="section-kicker">AVAILABLE INVENTORY</span><strong>總倉可用庫存 ${numberLabel(totalWarehouseAvailable())} 件</strong><span>已扣除保留量；每次配貨都會留下庫存異動紀錄。</span></div><button class="button light" data-action="navigate" data-view="masters">查看總倉庫存</button></div>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">DEMAND QUEUE</span><h2>待配貨需求</h2></div><span class="table-count">${demands.length} 張</span></div><div class="table-wrap"><table><thead><tr><th>需求單</th><th>門市</th><th>需求明細</th><th>需求量</th><th>已配 / 缺口</th><th>狀態</th><th>操作</th></tr></thead><tbody>${demands.map(renderAllocationDemandRow).join("") || emptyRow(7, "目前沒有待配貨需求")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">ALLOCATION ORDERS</span><h2>配貨單進度</h2></div><span class="table-count">${allocationHistory.length} 張</span></div><div class="table-wrap"><table><thead><tr><th>配貨單</th><th>送往門市</th><th>來源需求</th><th>數量</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody>${allocationHistory.map(renderAllocationRow).join("") || emptyRow(7, "尚未建立配貨單")}</tbody></table></div></section>`;
}

function renderAllocationDemandRow(demand) {
  const totals = demandTotals(demand);
  return `<tr><td><strong class="mono">${demand.demandNumber}</strong><small class="cell-sub">${demand.sourceType === "AUTO" ? "自動補貨轉單" : "門市人工需求"}</small></td><td><strong>${locationName(demand.locationId)}</strong></td><td><strong>${demand.items.length} 項</strong><small class="cell-sub">${demand.items.slice(0, 2).map((item) => productName(item.productId)).join("、")}${demand.items.length > 2 ? "…" : ""}</small></td><td><strong>${numberLabel(totals.requested)} 件</strong></td><td><span class="qty-progress">${numberLabel(totals.allocated)} / ${numberLabel(totals.shortage)}</span><small class="cell-sub">已配 / 尚缺</small></td><td>${statusChip(demand.status)}</td><td><div class="row-actions">${button("open-allocation", "處理配貨", "primary small", { id: demand.id })}</div></td></tr>`;
}

function renderAllocationRow(allocation) {
  const total = allocation.items.reduce((sum, item) => sum + toNumber(item.shippedQty), 0);
  return `<tr><td><strong class="mono">${allocation.allocationNumber}</strong><small class="cell-sub">${allocation.createdAt}</small></td><td><strong>${locationName(allocation.destinationLocationId)}</strong></td><td><strong class="mono">${demandNumber(allocation.demandOrderId)}</strong></td><td><strong>${numberLabel(total)} 件</strong><small class="cell-sub">${allocation.items.length} 項</small></td><td>${statusChip(allocation.status)}</td><td>${allocation.shippedAt || allocation.createdAt}</td><td>${allocation.status === "PICKING" ? button("ship-allocation", "標記出貨", "primary small", { id: allocation.id }) : allocation.status === "SHIPPED" ? `<span class="muted-text">等待門市簽收</span>` : `<span class="muted-text">已完成</span>`}</td></tr>`;
}

function renderPurchasing() {
  const suggestions = state.data.purchaseSuggestions.filter((item) => item.status === "PENDING");
  const orders = state.data.purchaseOrders;
  return `${renderPageIntro("PURCHASING DESK", "集中採購", "將總倉無法滿足的需求依商品與主要供應商彙總，保留來源需求追蹤。", button("generate-purchase", "↻ 產生採購建議", "primary"))}
    <div class="purchase-summary"><div><span>待採購缺口</span><strong>${purchaseGapCount()}<small> 項商品</small></strong><em>需求尚未被採購單覆蓋</em></div><div><span>系統建議採購量</span><strong>${numberLabel(suggestions.reduce((sum, item) => sum + item.suggestedQty, 0))}<small> 件</small></strong><em>已套用 MOQ 與採購倍數</em></div><div><span>進行中採購單</span><strong>${orders.filter((order) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)).length}<small> 張</small></strong><em>等待供應商到貨</em></div></div>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">PURCHASE SUGGESTIONS</span><h2>集中採購建議</h2></div><span class="table-count">${suggestions.length} 筆</span></div><div class="table-wrap"><table><thead><tr><th>商品 / 供應商</th><th>來源門市</th><th>原始缺口</th><th>MOQ / 倍數</th><th>建議採購</th><th>多買數量</th><th>操作</th></tr></thead><tbody>${suggestions.map(renderPurchaseSuggestionRow).join("") || emptyRow(7, "目前沒有待建立的採購建議")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">PURCHASE ORDERS</span><h2>採購單追蹤</h2></div><span class="table-count">${orders.length} 張</span></div><div class="table-wrap"><table><thead><tr><th>採購單</th><th>供應商</th><th>品項</th><th>預計到貨</th><th>狀態</th><th>已到 / 訂購</th><th>操作</th></tr></thead><tbody>${orders.map(renderPurchaseOrderRow).join("") || emptyRow(7, "尚未建立採購單")}</tbody></table></div></section>`;
}

function renderPurchaseSuggestionRow(suggestion) {
  const result = calculatePurchaseSuggestion(suggestion);
  return `<tr><td><strong>${productName(suggestion.productId)}</strong><small class="cell-sub">${productCode(suggestion.productId)} · ${supplierName(suggestion.supplierId)}</small></td><td><strong>${suggestion.sourceDemandIds.map((id) => locationName(getDemand(id)?.locationId)).filter(Boolean).join("、")}</strong><small class="cell-sub">${suggestion.sourceDemandIds.length} 張來源需求</small></td><td><strong class="red-text">${numberLabel(result.shortageQty)}</strong><small class="cell-sub">尚未滿足合計</small></td><td><span>${numberLabel(result.minimumOrderQuantity)} / ${numberLabel(result.purchaseMultiple)}</span><small class="cell-sub">MOQ / 採購倍數</small></td><td><strong class="accent-number">${numberLabel(result.suggestedQty)}</strong></td><td><strong>${numberLabel(result.overageQty)}</strong><small class="cell-sub">倍數調整量</small></td><td>${button("create-purchase-order", "建立採購單", "primary small", { id: suggestion.id })}</td></tr>`;
}

function renderPurchaseOrderRow(order) {
  const ordered = order.lines.reduce((sum, line) => sum + toNumber(line.orderedQty), 0);
  const received = order.lines.reduce((sum, line) => sum + toNumber(line.receivedQty), 0);
  return `<tr><td><strong class="mono">${order.purchaseOrderNumber}</strong><small class="cell-sub">${order.orderDate}</small></td><td><strong>${supplierName(order.supplierId)}</strong><small class="cell-sub">${supplierLeadTime(order.supplierId)} 天交期</small></td><td><strong>${order.lines.length} 項</strong><small class="cell-sub">${order.lines.map((line) => productName(line.productId)).join("、")}</small></td><td>${order.expectedDeliveryDate}</td><td>${statusChip(order.status)}</td><td><strong>${numberLabel(received)} / ${numberLabel(ordered)}</strong><small class="cell-sub">已到 / 訂購</small></td><td>${["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) ? button("open-receive-po", "登記到貨", "primary small", { id: order.id }) : `<span class="muted-text">已完成</span>`}</td></tr>`;
}

function renderReceipts() {
  const user = currentUser();
  const incoming = visibleAllocations().filter((item) => item.status === "SHIPPED");
  const purchaseOrders = state.data.purchaseOrders.filter((item) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(item.status));
  return `${renderPageIntro("RECEIVING DESK", "到貨與門市簽收", user.role === "STORE" ? "確認實收數量與差異原因，簽收後會增加門市庫存並更新需求狀態。" : "採購到貨先進入總倉；配貨出貨後，門市才能完成最後簽收。", user.role === "STORE" ? `<span class="inline-stat"><b>${incoming.length}</b> 待簽收</span>` : `<span class="inline-stat"><b>${purchaseOrders.length}</b> 張待到貨採購單</span>`)}
    ${user.role !== "STORE" ? `<section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">WAREHOUSE RECEIVING</span><h2>採購到貨</h2></div><button class="text-button" data-action="navigate" data-view="purchasing">查看採購單 →</button></div><div class="table-wrap"><table><thead><tr><th>採購單</th><th>供應商</th><th>品項</th><th>預計到貨</th><th>狀態</th><th>待到貨</th><th>操作</th></tr></thead><tbody>${purchaseOrders.map(renderPurchaseOrderRow).join("") || emptyRow(7, "目前沒有待登記到貨採購單")}</tbody></table></div></section>` : ""}
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">STORE RECEIVING</span><h2>待簽收配貨單</h2></div><span class="table-count">${incoming.length} 張</span></div><div class="table-wrap"><table><thead><tr><th>配貨單</th><th>需求單</th><th>出貨日期</th><th>配送品項</th><th>數量</th><th>狀態</th><th>操作</th></tr></thead><tbody>${incoming.map(renderIncomingRow).join("") || emptyRow(7, "目前沒有待簽收配貨單")}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-heading compact"><div><span class="section-kicker">RECEIVING HISTORY</span><h2>最近簽收紀錄</h2></div></div><div class="table-wrap"><table><thead><tr><th>配貨單</th><th>門市</th><th>簽收時間</th><th>實收數量</th><th>狀態</th></tr></thead><tbody>${visibleAllocations().filter((item) => item.status === "RECEIVED").slice(0, 8).map((item) => `<tr><td class="mono">${item.allocationNumber}</td><td>${locationName(item.destinationLocationId)}</td><td>${item.receivedAt || "—"}</td><td>${numberLabel(item.items.reduce((sum, line) => sum + line.receivedQty, 0))} 件</td><td>${statusChip(item.status)}</td></tr>`).join("") || emptyRow(5, "尚未有簽收紀錄")}</tbody></table></div></section>`;
}

function renderIncomingRow(allocation) {
  const total = allocation.items.reduce((sum, line) => sum + line.shippedQty, 0);
  return `<tr><td><strong class="mono">${allocation.allocationNumber}</strong></td><td><strong>${demandNumber(allocation.demandOrderId)}</strong></td><td>${allocation.shippedAt || "—"}</td><td><strong>${allocation.items.map((line) => productName(line.productId)).join("、")}</strong></td><td>${numberLabel(total)} 件</td><td>${statusChip(allocation.status)}</td><td>${button("open-receive-allocation", "開始簽收", "primary small", { id: allocation.id })}</td></tr>`;
}

function renderMasters() {
  const products = state.data.products;
  const search = String(state.filters.masterSearch || "").toLowerCase();
  const filtered = products.filter((product) => `${product.productCode} ${product.name} ${product.barcode} ${supplierName(product.supplierId)}`.toLowerCase().includes(search));
  const warehouseBalances = state.data.inventory.filter((balance) => balance.locationId === "warehouse");
  return `${renderPageIntro("MASTER DATA", "主檔與庫存", "管理商品、供應商與門市補貨參數；人工調整會寫入操作紀錄。", `${button("open-add-product", "＋ 新增商品", "primary")} ${button("open-adjust-inventory", "＋ 調整庫存", "secondary", { locationId: "warehouse" })}`)}
    <div class="master-grid"><section class="panel master-stat"><span class="section-kicker">ACTIVE PRODUCTS</span><strong>${products.filter((p) => p.isActive).length}<small> / ${products.length}</small></strong><span>商品主檔</span></section><section class="panel master-stat"><span class="section-kicker">SUPPLIERS</span><strong>${state.data.suppliers.length}</strong><span>主要供應商</span></section><section class="panel master-stat"><span class="section-kicker">STORE SETTINGS</span><strong>${state.data.settings.length}</strong><span>門市商品補貨參數</span></section><section class="panel master-stat"><span class="section-kicker">WAREHOUSE SKUs</span><strong>${warehouseSkuCount()}</strong><span>有可用量 SKU</span></section></div>
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="masterSearch" value="${escapeHtml(state.filters.masterSearch || "")}" placeholder="搜尋商品、條碼或供應商" /></label><span class="toolbar-spacer"></span><span class="table-count">${filtered.length} 項商品</span></div><div class="table-wrap"><table><thead><tr><th>商品</th><th>分類 / 規格</th><th>主要供應商</th><th>總倉庫存</th><th>門市補貨參數</th><th>狀態</th><th>操作</th></tr></thead><tbody>${filtered.map((product) => { const balance = getBalance("warehouse", product.id); const settings = state.data.settings.filter((item) => item.productId === product.id); return `<tr><td><strong>${product.name}</strong><small class="cell-sub mono">${product.productCode} · ${product.barcode}</small></td><td><span>${product.category}</span><small class="cell-sub">${product.specification} · ${product.baseUnit}</small></td><td>${supplierName(product.supplierId)}<small class="cell-sub">交期 ${supplierLeadTime(product.supplierId)} 天</small></td><td><strong class="big-cell">${numberLabel(balance?.onHandQty || 0)}</strong><small class="cell-sub">可用 ${numberLabel(availableInventory(balance))}</small></td><td><span>${settings.length} 門市</span><small class="cell-sub">安全庫存 ${numberLabel(settings.reduce((sum, item) => sum + item.safetyStockQty, 0))}</small></td><td>${product.isActive ? `<span class="status active">啟用</span>` : `<span class="status muted">停用</span>`}</td><td>${button("open-adjust-inventory", "調整庫存", "ghost small", { locationId: "warehouse", productId: product.id })}</td></tr>`; }).join("") || emptyRow(7, "找不到商品")}</tbody></table></div></section>
    <div class="two-column"><section class="panel"><div class="panel-heading compact"><div><span class="section-kicker">SUPPLIERS</span><h2>供應商主檔</h2></div></div><div class="stack-list">${state.data.suppliers.map((supplier) => `<div class="list-row"><span class="avatar supplier">${supplier.name.slice(0, 1)}</span><div><strong>${supplier.name}</strong><small>${supplier.code} · ${supplier.contact} · ${supplier.phone}</small></div><span class="row-end">${supplier.leadTimeDays} 天</span></div>`).join("")}</div></section><section class="panel"><div class="panel-heading compact"><div><span class="section-kicker">REPLENISHMENT SETTINGS</span><h2>補貨參數範例</h2></div></div><div class="stack-list">${state.data.settings.filter((item) => item.locationId === "store01").slice(0, 6).map((item) => `<div class="list-row"><div><strong>${productName(item.productId)}</strong><small>${locationName(item.locationId)} · 自動補貨 ${item.automaticReplenishmentEnabled ? "開啟" : "關閉"}</small></div><span class="setting-pill">${item.safetyStockQty} / ${item.maximumStockQty} · ×${item.storeDistributionMultiple}</span></div>`).join("")}</div></section></div>`;
}

function renderUsers() {
  return `${renderPageIntro("ACCESS CONTROL", "使用者管理", "Phase 1 使用簡化帳號密碼與四種角色；門市資料範圍綁定登入帳號的 location_id。", button("open-add-user", "＋ 新增使用者", "primary"))}
    <div class="permission-callout"><div class="formula-icon">◎</div><div><strong>資料隔離規則</strong><span>STORE 只能讀寫所屬門市；WAREHOUSE 可處理所有門市需求；ADMIN 可使用全部功能。</span></div></div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>使用者</th><th>角色</th><th>所屬單位</th><th>狀態</th><th>最後登入</th><th>操作</th></tr></thead><tbody>${state.data.users.map((user) => `<tr><td><div class="user-cell"><span class="avatar ${user.role.toLowerCase()}">${user.displayName.slice(0, 1)}</span><div><strong>${user.displayName}</strong><small class="cell-sub mono">${user.username}</small></div></div></td><td><span class="role-tag ${user.role.toLowerCase()}">${ROLE_LABELS[user.role]}</span></td><td>${user.locationId ? locationName(user.locationId) : "全域"}</td><td>${user.isActive ? `<span class="status active">啟用</span>` : `<span class="status muted">停用</span>`}</td><td>${user.lastLoginAt || "尚未登入"}</td><td>${user.id === currentUser().id ? `<span class="muted-text">目前帳號</span>` : button("toggle-user", user.isActive ? "停用" : "啟用", "ghost small", { id: user.id })}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderAudit() {
  const search = String(state.filters.auditSearch || "").toLowerCase();
  const logs = state.data.auditLogs.filter((log) => `${log.action} ${log.detail} ${userName(log.userId)} ${log.entityType}`.toLowerCase().includes(search));
  return `${renderPageIntro("AUDIT TRAIL", "操作紀錄", "保留重要操作的操作者、資料類型與結果，協助流程驗證與問題追溯。", `<span class="inline-stat"><b>${state.data.auditLogs.length}</b> 筆紀錄</span>`)}
    <section class="panel table-panel"><div class="toolbar"><label class="search-field"><span>⌕</span><input data-filter-key="auditSearch" value="${escapeHtml(state.filters.auditSearch || "")}" placeholder="搜尋操作者、動作或內容" /></label><span class="toolbar-spacer"></span><span class="table-count">${logs.length} 筆</span></div><div class="table-wrap"><table><thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>資料類型</th><th>內容</th></tr></thead><tbody>${logs.map((log) => `<tr><td class="mono">${log.createdAt}</td><td>${userName(log.userId)}</td><td><strong>${log.action}</strong></td><td><span class="entity-chip">${log.entityType}</span></td><td>${escapeHtml(log.detail)}</td></tr>`).join("") || emptyRow(5, "目前沒有符合條件的紀錄")}</tbody></table></div></section>`;
}

function renderAttentionItem(item) {
  return `<button class="attention-item ${item.tone}" data-action="navigate" data-view="${item.view}"><span class="attention-icon">${item.icon}</span><span><strong>${item.title}</strong><small>${item.detail}</small></span><b>→</b></button>`;
}

function renderCompactDemandList(demands) {
  if (!demands.length) return emptyState("目前沒有需求", "建立一筆需求後，會在這裡顯示處理進度。");
  return `<div class="compact-list">${demands.map((demand) => `<button class="compact-row" data-action="open-demand" data-id="${demand.id}"><span class="compact-mark ${demand.status.toLowerCase()}">${demand.sourceType === "AUTO" ? "↻" : "↗"}</span><span><strong>${demand.demandNumber}</strong><small>${locationName(demand.locationId)} · ${demand.items.length} 項商品</small></span><span class="row-end">${statusChip(demand.status)}</span></button>`).join("")}</div>`;
}

function renderInventorySignals() {
  const signals = state.data.products.map((product) => ({ product, balance: getBalance("warehouse", product.id) })).sort((a, b) => availableInventory(a.balance) - availableInventory(b.balance)).slice(0, 4);
  return `<div class="signal-list">${signals.map(({ product, balance }) => { const available = availableInventory(balance); const tone = available < 18 ? "danger" : available < 30 ? "warn" : "ok"; return `<div class="signal-row"><span class="signal-bar ${tone}"><i style="width:${Math.min(100, available * 1.6)}%"></i></span><div><strong>${product.name}</strong><small>${product.productCode} · ${product.category}</small></div><b>${numberLabel(available)}<small> 可用</small></b></div>`; }).join("")}</div>`;
}

function renderModal() {
  const modal = state.modal;
  const title = modalTitle(modal.type);
  const content = modal.type === "create-demand" ? renderCreateDemandModal() : modal.type === "demand-detail" ? renderDemandDetailModal(modal.demandId) : modal.type === "confirm-suggestion" ? renderSuggestionModal(modal.suggestionId) : modal.type === "allocation" ? renderAllocationModal(modal.demandId) : modal.type === "receive-allocation" ? renderReceiveAllocationModal(modal.allocationId) : modal.type === "receive-purchase" ? renderReceivePurchaseModal(modal.purchaseOrderId) : modal.type === "add-product" ? renderAddProductModal() : modal.type === "adjust-inventory" ? renderAdjustInventoryModal(modal) : modal.type === "add-user" ? renderAddUserModal() : renderProfileModal();
  return `<div class="modal-backdrop" role="presentation"><section class="modal-card ${modal.type === "demand-detail" ? "wide-modal" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><div><span class="section-kicker">${modal.type === "profile" ? "ACCOUNT" : "PHASE 1 ACTION"}</span><h2 id="modalTitle">${title}</h2></div><button class="icon-button" data-action="close-modal" aria-label="關閉">×</button></div>${content}</section></div>`;
}

function renderCreateDemandModal() {
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>需求類型</span><select name="demandType" required>${["GENERAL", "URGENT", "CUSTOMER_ORDER", "PROMOTION", "NEW_PRODUCT", "OTHER"].map((type) => `<option value="${type}">${demandTypeLabel(type)}</option>`).join("")}</select></label><label class="field"><span>希望到貨日</span><input name="requiredDate" type="date" value="2026-07-25" required /></label></div><label class="field"><span>商品</span><select name="productId" required>${state.data.products.filter((product) => product.isActive).map((product) => `<option value="${product.id}">${product.productCode} · ${product.name} · ${product.specification}</option>`).join("")}</select></label><div class="form-grid"><label class="field"><span>需求數量</span><input name="requestedQty" type="number" min="1" step="1" value="6" required /></label><label class="field"><span>原因（急件 / 客訂 / 活動 / 其他必填）</span><input name="reason" type="text" placeholder="例如：客人預訂、活動備貨" /></label></div><label class="field"><span>備註</span><textarea name="notes" placeholder="補充門市、配送或驗收資訊"></textarea></label><div class="modal-note">送出後會進入總倉需求池；同門市同商品已有未完成需求時，系統會提醒但不阻擋驗證流程。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立並送出需求</button></div></form>`;
}

function renderDemandDetailModal(demandId) {
  const demand = getDemand(demandId);
  if (!demand) return emptyState("找不到需求", "這筆資料可能已被重設。");
  return `<div class="detail-meta"><span class="mono">${demand.demandNumber}</span>${statusChip(demand.status)}<span class="source-chip ${demand.sourceType.toLowerCase()}">${demand.sourceType === "AUTO" ? "自動補貨" : "人工需求"}</span></div><div class="detail-grid"><div><span>門市</span><strong>${locationName(demand.locationId)}</strong></div><div><span>需求日</span><strong>${demand.requiredDate}</strong></div><div><span>建立人</span><strong>${userName(demand.createdBy)}</strong></div><div><span>建立時間</span><strong>${demand.createdAt}</strong></div></div><div class="detail-section"><div class="section-row"><h3>需求明細</h3><span>${demand.items.length} 項</span></div><div class="detail-lines">${demand.items.map((item) => `<div class="detail-line"><div><strong>${productName(item.productId)}</strong><small>${productCode(item.productId)} · ${item.reason || "—"}</small></div><span><b>${numberLabel(item.requestedQty)}</b> 件需求</span><span>已配 ${numberLabel(item.allocatedQty)} · 已收 ${numberLabel(item.receivedQty)}</span></div>`).join("")}</div></div><div class="detail-note"><span>備註</span><p>${escapeHtml(demand.notes || "無")}</p></div><div class="modal-actions"><button class="button ghost" data-action="close-modal">關閉</button>${currentUser().role === "STORE" && demand.status === "DRAFT" ? button("submit-demand", "送出需求", "primary", { id: demand.id }) : ""}${["ADMIN", "WAREHOUSE"].includes(currentUser().role) && ["SUBMITTED", "DRAFT"].includes(demand.status) ? button("approve-demand", "核准需求", "primary", { id: demand.id }) : ""}</div>`;
}

function renderSuggestionModal(suggestionId) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return emptyState("找不到補貨建議", "請重新執行計算。");
  return `<form id="entityForm" class="modal-form"><div class="suggestion-highlight"><span class="flow-symbol demand">↻</span><div><strong>${productName(suggestion.productId)}</strong><small>${locationName(suggestion.locationId)} · 原始建議 ${numberLabel(suggestion.suggestedQty)} 件</small></div><b>${numberLabel(suggestion.suggestedQty)}<small>件</small></b></div><div class="form-grid"><label class="field"><span>確認數量</span><input name="confirmedQty" type="number" min="1" step="1" value="${suggestion.suggestedQty}" required /></label><label class="field"><span>調整原因（若修改必填）</span><input name="adjustmentReason" placeholder="例如：門市庫位有限" /></label></div><input type="hidden" name="suggestionId" value="${suggestion.id}" /><div class="modal-note">確認後會建立一張 source_type=AUTO 的正式需求單，不會直接建立採購單。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">確認並轉正式需求</button></div></form>`;
}

function renderAllocationModal(demandId) {
  const demand = getDemand(demandId);
  if (!demand) return emptyState("找不到需求", "請重新整理需求池。");
  return `<div class="allocation-summary"><div><span>需求單</span><strong class="mono">${demand.demandNumber}</strong></div><div><span>配送門市</span><strong>${locationName(demand.locationId)}</strong></div><div><span>總倉可用</span><strong class="green-text">${numberLabel(totalWarehouseAvailable())} 件</strong></div></div><div class="allocation-lines">${demand.items.map((item) => { const balance = getBalance("warehouse", item.productId); const need = demandOutstanding(item); const canAllocate = Math.min(need, availableInventory(balance)); return `<div class="allocation-line"><div><strong>${productName(item.productId)}</strong><small>${productCode(item.productId)} · 需求 ${numberLabel(item.requestedQty)} 件</small></div><div class="allocation-qty"><span>已配 ${numberLabel(item.allocatedQty)}</span><strong>${numberLabel(canAllocate)}<small> 可立即配</small></strong><span>缺口 ${numberLabel(Math.max(0, need - canAllocate))}</span></div></div>`; }).join("")}</div><div class="modal-note"><b>配貨檢查：</b>本次配貨會扣減總倉可用庫存並建立配貨單；不足數量會保留在採購缺口。</div><div class="modal-actions"><button class="button ghost" data-action="close-modal">取消</button><button class="button secondary" data-action="create-allocation" data-id="${demand.id}" data-mode="shortage">部分配貨 / 轉採購</button><button class="button primary" data-action="create-allocation" data-id="${demand.id}" data-mode="available">依可用量建立配貨單</button></div>`;
}

function renderReceiveAllocationModal(allocationId) {
  const allocation = state.data.allocations.find((item) => item.id === allocationId);
  if (!allocation) return emptyState("找不到配貨單", "請重新整理待簽收清單。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${allocation.allocationNumber}</span><span class="source-chip manual">配送至 ${locationName(allocation.destinationLocationId)}</span></div>${allocation.items.map((item) => `<div class="receive-line"><div><strong>${productName(item.productId)}</strong><small>應收 ${numberLabel(item.shippedQty)} 件</small></div><label class="field"><span>實收數量</span><input name="received_${item.id}" type="number" min="0" max="${item.shippedQty}" step="1" value="${item.shippedQty}" required /></label></div>`).join("")}<label class="field"><span>差異原因 / 備註</span><textarea name="receiveNotes" placeholder="若實收與出貨數量不同，請填寫原因"></textarea></label><input type="hidden" name="allocationId" value="${allocation.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">確認簽收並增加門市庫存</button></div></form>`;
}

function renderReceivePurchaseModal(purchaseOrderId) {
  const order = state.data.purchaseOrders.find((item) => item.id === purchaseOrderId);
  if (!order) return emptyState("找不到採購單", "請重新整理採購單列表。");
  return `<form id="entityForm" class="modal-form"><div class="detail-meta"><span class="mono">${order.purchaseOrderNumber}</span><span class="source-chip auto">${supplierName(order.supplierId)}</span></div>${order.lines.map((line) => { const remaining = Math.max(0, line.orderedQty - line.receivedQty); return `<div class="receive-line"><div><strong>${productName(line.productId)}</strong><small>已到 ${numberLabel(line.receivedQty)} · 待到 ${numberLabel(remaining)} 件</small></div><label class="field"><span>本次到貨</span><input name="received_${line.id}" type="number" min="0" max="${remaining}" step="1" value="${remaining}" required /></label></div>`; }).join("")}<label class="field"><span>到貨備註</span><textarea name="receiveNotes" placeholder="例如：部分到貨、批號待補"></textarea></label><input type="hidden" name="purchaseOrderId" value="${order.id}" /><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">確認到貨並入總倉</button></div></form>`;
}

function renderAddProductModal() {
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>商品編號</span><input name="productCode" placeholder="PH-0021" required /></label><label class="field"><span>條碼</span><input name="barcode" inputmode="numeric" placeholder="4710001000021" required /></label></div><label class="field"><span>商品名稱</span><input name="name" required /></label><div class="form-grid"><label class="field"><span>規格</span><input name="specification" placeholder="30錠/盒" required /></label><label class="field"><span>分類</span><select name="category"><option>一般藥品</option><option>保健食品</option><option>醫療用品</option><option>日用品</option><option>醫療器材</option></select></label></div><label class="field"><span>主要供應商</span><select name="supplierId">${state.data.suppliers.map((supplier) => `<option value="${supplier.id}">${supplier.name}</option>`).join("")}</select></label><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立商品</button></div></form>`;
}

function renderAdjustInventoryModal(modal) {
  const productOptions = state.data.products.map((product) => `<option value="${product.id}" ${modal.productId === product.id ? "selected" : ""}>${product.productCode} · ${product.name}</option>`).join("");
  const locationOptions = state.data.locations.map((location) => `<option value="${location.id}" ${modal.locationId === location.id ? "selected" : ""}>${location.code} · ${location.name}</option>`).join("");
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>地點</span><select name="locationId">${locationOptions}</select></label><label class="field"><span>商品</span><select name="productId">${productOptions}</select></label></div><div class="inventory-adjust-card"><span>目前數量</span><strong>${numberLabel(getBalance(modal.locationId || "warehouse", modal.productId || state.data.products[0].id)?.onHandQty || 0)} 件</strong><small>只允許調整為 0 以上的整數</small></div><label class="field"><span>調整後數量</span><input name="onHandQty" type="number" min="0" step="1" value="${getBalance(modal.locationId || "warehouse", modal.productId || state.data.products[0].id)?.onHandQty || 0}" required /></label><label class="field"><span>調整原因</span><textarea name="reason" required placeholder="例如：盤點差異、報廢、初始補登"></textarea></label><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">儲存庫存調整</button></div></form>`;
}

function renderAddUserModal() {
  return `<form id="entityForm" class="modal-form"><div class="form-grid"><label class="field"><span>帳號</span><input name="username" pattern="[a-zA-Z0-9_]+" required /></label><label class="field"><span>顯示名稱</span><input name="displayName" required /></label></div><div class="form-grid"><label class="field"><span>角色</span><select name="role">${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}">${label}</option>`).join("")}</select></label><label class="field"><span>所屬單位（門市必選）</span><select name="locationId"><option value="">全域 / 不綁定</option>${state.data.locations.map((location) => `<option value="${location.id}">${location.name}</option>`).join("")}</select></label></div><div class="modal-note">新增帳號後會要求使用者在此瀏覽器重新設定示範密碼；正式環境應由後端 seed 與密碼雜湊處理。</div><div class="modal-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button class="button primary" type="submit">建立使用者</button></div></form>`;
}

function renderProfileModal() {
  const user = currentUser();
  return `<div class="profile-card"><span class="avatar ${user.role.toLowerCase()} large-avatar">${user.displayName.slice(0, 1)}</span><div><span class="section-kicker">SIGNED IN AS</span><h3>${user.displayName}</h3><p>${user.username} · ${ROLE_LABELS[user.role]}</p><p>${user.locationId ? locationName(user.locationId) : "全域管理範圍"}</p></div></div><div class="profile-note">目前為瀏覽器本機流程驗證版。切換角色請登出後使用另一個測試帳號。</div><div class="modal-actions"><button class="button ghost" data-action="close-modal">關閉</button><button class="button secondary" data-action="logout">登出</button></div>`;
}

function handleModalSubmit(formData) {
  const type = state.modal?.type;
  if (type === "create-demand") createDemand(formData);
  if (type === "confirm-suggestion") confirmSuggestion(formData);
  if (type === "receive-allocation") receiveAllocation(formData);
  if (type === "receive-purchase") receivePurchase(formData);
  if (type === "add-product") addProduct(formData);
  if (type === "adjust-inventory") adjustInventory(formData);
  if (type === "add-user") addUser(formData);
}

function createDemand(formData) {
  const user = currentUser();
  const demandType = String(formData.get("demandType"));
  const reason = String(formData.get("reason") || "").trim();
  if (["URGENT", "CUSTOMER_ORDER", "PROMOTION", "NEW_PRODUCT", "OTHER"].includes(demandType) && !reason) return showToast("此需求類型必須填寫原因", "error");
  const demandId = createId("demand");
  const demandNumber = nextNumber("DN");
  state.data.demands.unshift({ id: demandId, demandNumber, locationId: user.role === "STORE" ? user.locationId : "store01", sourceType: "MANUAL", demandType, requiredDate: String(formData.get("requiredDate")), status: "SUBMITTED", notes: String(formData.get("notes") || "").trim(), createdBy: user.id, createdAt: `${today} 09:00`, submittedAt: `${today} 09:00`, items: [{ id: createId("ditem"), productId: String(formData.get("productId")), requestedQty: Math.max(1, toNumber(formData.get("requestedQty"))), approvedQty: 0, allocatedQty: 0, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason, notes: "" }] });
  addAudit("建立並送出需求", "DEMAND", demandId, `${demandNumber} · ${productName(String(formData.get("productId")))} · ${formData.get("requestedQty")} 件`);
  closeModal();
  state.view = "demands";
  showToast(`${demandNumber} 已送出至總倉需求池`, "success");
  render();
}

function submitDemand(demandId) {
  const demand = getDemand(demandId);
  if (!demand || !canAccessDemand(demand)) return showToast("沒有權限操作這筆需求", "error");
  if (demand.status !== "DRAFT") return showToast("只有草稿需求可以送出", "error");
  demand.status = "SUBMITTED";
  demand.submittedAt = `${today} 09:00`;
  addAudit("送出需求", "DEMAND", demand.id, `${demand.demandNumber} 已送出至總倉`);
  saveData();
  showToast("需求已送出", "success");
  closeModal();
  render();
}

function approveDemand(demandId) {
  const demand = getDemand(demandId);
  if (!demand || !["ADMIN", "WAREHOUSE"].includes(currentUser().role)) return showToast("目前帳號無法核准需求", "error");
  if (!isOpenDemandStatus(demand.status)) return showToast("已完成或取消的需求不可核准", "error");
  demand.status = "APPROVED";
  demand.items.forEach((item) => { item.approvedQty = item.requestedQty; });
  addAudit("核准需求", "DEMAND", demand.id, `${demand.demandNumber} 已核准，等待配貨`);
  saveData();
  closeModal();
  showToast("需求已核准，可進行配貨", "success");
  render();
}

function runReplenishment(scope) {
  const user = currentUser();
  if (!(["ADMIN", "STORE"].includes(user.role))) return showToast("只有管理者或門市可以執行補貨計算", "error");
  const locationIds = scope === "all" && user.role === "ADMIN" ? state.data.locations.filter((location) => location.type === "STORE").map((location) => location.id) : [user.role === "STORE" ? user.locationId : "store01"];
  const created = [];
  locationIds.forEach((locationId) => {
    state.data.settings.filter((setting) => setting.locationId === locationId && setting.automaticReplenishmentEnabled).forEach((setting) => {
      const existing = state.data.replenishmentSuggestions.find((item) => item.locationId === locationId && item.productId === setting.productId && item.status === "PENDING");
      if (existing) return;
      const balance = getBalance(locationId, setting.productId) || {};
      const result = calculateReplenishment({
        onHandQty: balance.onHandQty,
        reservedQty: balance.reservedQty,
        allocationInTransitQty: allocationInTransit(locationId, setting.productId),
        purchaseInboundAllocatedQty: purchaseInbound(locationId, setting.productId),
        existingOpenDemandQty: existingOpenDemand(locationId, setting.productId),
        safetyStockQty: setting.safetyStockQty,
        maximumStockQty: setting.maximumStockQty,
        minimumReplenishmentQty: setting.minimumReplenishmentQty,
        storeDistributionMultiple: setting.storeDistributionMultiple,
        automaticReplenishmentEnabled: setting.automaticReplenishmentEnabled,
      });
      if (result.eligible && result.suggestedQty > 0) {
        const suggestion = { id: createId("suggestion"), locationId, productId: setting.productId, status: "PENDING", createdAt: `${today} 09:00`, runId: createId("run"), ...result, reason: `低於安全庫存 ${setting.safetyStockQty} 件` };
        state.data.replenishmentSuggestions.unshift(suggestion);
        created.push(suggestion);
      }
    });
  });
  addAudit("執行自動補貨計算", "REPLENISHMENT_RUN", createId("run"), `${locationIds.map(locationName).join("、")} · 產生 ${created.length} 筆建議`);
  saveData();
  state.view = "replenishment";
  showToast(created.length ? `已產生 ${created.length} 筆補貨建議` : "沒有新增建議，既有待確認資料已保留", "success");
  render();
}

function confirmSuggestion(formData) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === String(formData.get("suggestionId")));
  if (!suggestion || suggestion.status !== "PENDING") return showToast("此建議已處理", "error");
  const confirmedQty = Math.max(1, toNumber(formData.get("confirmedQty")));
  const adjustmentReason = String(formData.get("adjustmentReason") || "").trim();
  if (confirmedQty !== suggestion.suggestedQty && !adjustmentReason) return showToast("修改建議數量時必須填寫調整原因", "error");
  suggestion.status = "ACCEPTED";
  suggestion.originalSuggestedQty = suggestion.suggestedQty;
  suggestion.confirmedQty = confirmedQty;
  suggestion.adjustmentReason = adjustmentReason || "依系統建議確認";
  suggestion.adjustedBy = currentUser().id;
  suggestion.adjustedAt = `${today} 09:00`;
  const demandId = createId("demand");
  suggestion.demandId = demandId;
  state.data.demands.unshift({ id: demandId, demandNumber: nextNumber("DN"), locationId: suggestion.locationId, sourceType: "AUTO", demandType: "GENERAL", requiredDate: today, status: "SUBMITTED", notes: `由自動補貨建議轉入；${suggestion.adjustmentReason}`, createdBy: currentUser().id, createdAt: `${today} 09:00`, submittedAt: `${today} 09:00`, items: [{ id: createId("ditem"), productId: suggestion.productId, requestedQty: confirmedQty, approvedQty: 0, allocatedQty: 0, purchaseRequiredQty: 0, purchaseOrderedQty: 0, purchaseReceivedQty: 0, receivedQty: 0, reason: "安全庫存觸發", notes: "" }] });
  addAudit("確認補貨建議並轉需求", "REPLENISHMENT_SUGGESTION", suggestion.id, `${productName(suggestion.productId)} · ${numberLabel(confirmedQty)} 件 · ${suggestion.adjustmentReason}`);
  saveData();
  closeModal();
  state.view = "demands";
  showToast("補貨建議已轉為正式需求", "success");
  render();
}

function updateSuggestion(id, patch, action) {
  const suggestion = state.data.replenishmentSuggestions.find((item) => item.id === id);
  if (!suggestion) return;
  Object.assign(suggestion, patch);
  addAudit(action, "REPLENISHMENT_SUGGESTION", id, `${productName(suggestion.productId)} · ${locationName(suggestion.locationId)}`);
  saveData();
  showToast("補貨建議狀態已更新", "success");
  render();
}

function createAllocation(demandId, mode) {
  const demand = getDemand(demandId);
  if (!demand || !["ADMIN", "WAREHOUSE"].includes(currentUser().role)) return showToast("目前帳號無法建立配貨單", "error");
  if (!["SUBMITTED", "APPROVED", "PARTIALLY_ALLOCATED", "WAITING_PURCHASE"].includes(demand.status)) return showToast("此需求目前不可配貨", "error");
  const lines = [];
  let allocatedAny = false;
  demand.items.forEach((item) => {
    const need = demandOutstanding(item);
    const balance = getBalance("warehouse", item.productId);
    const available = availableInventory(balance);
    const qty = mode === "shortage" ? Math.min(need, available) : Math.min(need, available);
    if (qty > 0) {
      item.allocatedQty += qty;
      item.approvedQty = item.approvedQty || item.requestedQty;
      allocatedAny = true;
      balance.onHandQty -= qty;
      lines.push({ id: createId("aitem"), productId: item.productId, requestedQty: item.requestedQty, allocatedQty: qty, shippedQty: qty, receivedQty: 0 });
    }
    item.purchaseRequiredQty = Math.max(0, item.requestedQty - item.allocatedQty - item.receivedQty);
  });
  const remaining = demand.items.reduce((sum, item) => sum + demandUnallocated(item) + purchaseCoverage(item), 0);
  const shortage = demand.items.reduce((sum, item) => sum + Math.max(0, item.requestedQty - item.allocatedQty - item.receivedQty), 0);
  demand.status = shortage > 0 ? (allocatedAny ? "PARTIALLY_ALLOCATED" : "WAITING_PURCHASE") : "PROCESSING";
  if (allocatedAny) {
    const allocationId = createId("allocation");
    state.data.allocations.unshift({ id: allocationId, allocationNumber: nextNumber("AL"), sourceLocationId: "warehouse", destinationLocationId: demand.locationId, demandOrderId: demand.id, status: "PICKING", shippedAt: null, receivedAt: null, createdBy: currentUser().id, createdAt: `${today} 09:00`, items: lines });
    addAudit("建立配貨單", "ALLOCATION", allocationId, `${demand.demandNumber} · ${lines.reduce((sum, line) => sum + line.allocatedQty, 0)} 件 · 尚缺 ${shortage} 件`);
  } else {
    addAudit("轉入集中採購", "DEMAND", demand.id, `${demand.demandNumber} 無總倉可用庫存，尚缺 ${shortage} 件`);
  }
  saveData();
  closeModal();
  state.view = allocatedAny ? "allocations" : "purchasing";
  showToast(allocatedAny ? `已建立配貨單，${shortage ? `另有 ${shortage} 件進入採購缺口` : "可標記出貨"}` : "已轉入集中採購缺口", "success");
  render();
}

function shipAllocation(allocationId) {
  const allocation = state.data.allocations.find((item) => item.id === allocationId);
  if (!allocation || allocation.status !== "PICKING") return showToast("此配貨單目前不可出貨", "error");
  allocation.status = "SHIPPED";
  allocation.shippedAt = `${today} 16:20`;
  addAudit("配貨出貨", "ALLOCATION", allocation.id, `${allocation.allocationNumber} 已出貨至 ${locationName(allocation.destinationLocationId)}`);
  saveData();
  showToast("配貨單已出貨，等待門市簽收", "success");
  render();
}

function receiveAllocation(formData) {
  const allocation = state.data.allocations.find((item) => item.id === String(formData.get("allocationId")));
  const user = currentUser();
  if (!allocation || allocation.status !== "SHIPPED" || (user.role === "STORE" && allocation.destinationLocationId !== user.locationId)) return showToast("沒有權限或此配貨單不可簽收", "error");
  allocation.items.forEach((line) => {
    const receivedQty = Math.min(line.shippedQty, Math.max(0, toNumber(formData.get(`received_${line.id}`))));
    line.receivedQty = receivedQty;
    const balance = getBalance(allocation.destinationLocationId, line.productId);
    balance.onHandQty += receivedQty;
    const demand = getDemand(allocation.demandOrderId);
    const demandItem = demand?.items.find((item) => item.productId === line.productId);
    if (demandItem) demandItem.receivedQty += receivedQty;
  });
  allocation.status = "RECEIVED";
  allocation.receivedAt = `${today} 17:00`;
  const demand = getDemand(allocation.demandOrderId);
  if (demand) {
    const allComplete = demand.items.every((item) => demandOutstanding(item) === 0);
    const anyGap = demand.items.some((item) => demandOutstanding(item) > 0);
    demand.status = allComplete ? "COMPLETED" : anyGap ? "PARTIALLY_ALLOCATED" : "PROCESSING";
  }
  addAudit("門市簽收", "ALLOCATION", allocation.id, `${allocation.allocationNumber} · ${locationName(allocation.destinationLocationId)} · ${String(formData.get("receiveNotes") || "無差異備註")}`);
  saveData();
  closeModal();
  showToast("簽收完成，門市庫存已更新", "success");
  render();
}

function generatePurchaseSuggestions() {
  if (!["ADMIN", "PURCHASING", "WAREHOUSE"].includes(currentUser().role)) return showToast("目前帳號無法產生採購建議", "error");
  const groups = new Map();
  state.data.demands.forEach((demand) => {
    if (!isOpenDemandStatus(demand.status)) return;
    demand.items.forEach((item) => {
      const shortage = Math.max(0, item.requestedQty - item.allocatedQty - item.receivedQty - item.purchaseOrderedQty + item.purchaseReceivedQty);
      if (shortage <= 0) return;
      const product = state.data.products.find((candidate) => candidate.id === item.productId);
      if (!product) return;
      const key = `${item.productId}_${product.supplierId}`;
      const group = groups.get(key) || { productId: item.productId, supplierId: product.supplierId, shortageQty: 0, sourceDemandIds: [] };
      group.shortageQty += shortage;
      if (!group.sourceDemandIds.includes(demand.id)) group.sourceDemandIds.push(demand.id);
      groups.set(key, group);
    });
  });
  let created = 0;
  groups.forEach((group) => {
    const existing = state.data.purchaseSuggestions.find((item) => item.productId === group.productId && item.status === "PENDING");
    if (existing) return;
    const supplierProduct = getSupplierProduct(group.productId, group.supplierId);
    const result = calculatePurchaseSuggestion({ shortageQty: group.shortageQty, minimumOrderQuantity: supplierProduct?.minimumOrderQuantity, purchaseMultiple: supplierProduct?.purchaseMultiple });
    state.data.purchaseSuggestions.unshift({ id: createId("purchaseSuggestion"), ...group, ...result, status: "PENDING", createdAt: `${today} 09:00` });
    created += 1;
  });
  addAudit("產生集中採購建議", "PURCHASE_SUGGESTION", createId("run"), `掃描 ${state.data.demands.length} 張需求，新增 ${created} 筆`);
  saveData();
  state.view = "purchasing";
  showToast(created ? `已新增 ${created} 筆集中採購建議` : "沒有新增採購建議", "success");
  render();
}

function createPurchaseOrder(suggestionId) {
  const suggestion = state.data.purchaseSuggestions.find((item) => item.id === suggestionId && item.status === "PENDING");
  if (!suggestion || !["ADMIN", "PURCHASING"].includes(currentUser().role)) return showToast("目前帳號無法建立採購單", "error");
  const supplierProduct = getSupplierProduct(suggestion.productId, suggestion.supplierId);
  const orderId = createId("po");
  const order = { id: orderId, purchaseOrderNumber: nextNumber("PO"), supplierId: suggestion.supplierId, orderDate: today, expectedDeliveryDate: addDays(today, supplierLeadTime(suggestion.supplierId)), status: "ORDERED", notes: `由集中採購建議建立；來源 ${suggestion.sourceDemandIds.join(", ")}`, createdBy: currentUser().id, createdAt: `${today} 09:00`, lines: [{ id: createId("poline"), productId: suggestion.productId, orderedQty: suggestion.suggestedQty, purchasePrice: supplierProduct?.purchasePrice || 0, receivedQty: 0, sourceDemandIds: suggestion.sourceDemandIds }] };
  state.data.purchaseOrders.unshift(order);
  suggestion.status = "ORDERED";
  suggestion.purchaseOrderId = orderId;
  suggestion.confirmedQty = suggestion.suggestedQty;
  suggestion.confirmedBy = currentUser().id;
  suggestion.confirmedAt = `${today} 09:00`;
  suggestion.sourceDemandIds.forEach((demandId) => {
    const demand = getDemand(demandId);
    demand?.items.forEach((item) => { if (item.productId === suggestion.productId) item.purchaseOrderedQty += suggestion.suggestedQty; });
  });
  addAudit("建立採購單", "PURCHASE_ORDER", orderId, `${order.purchaseOrderNumber} · ${supplierName(order.supplierId)} · ${suggestion.suggestedQty} 件`);
  saveData();
  showToast(`${order.purchaseOrderNumber} 已建立`, "success");
  render();
}

function receivePurchase(formData) {
  const order = state.data.purchaseOrders.find((item) => item.id === String(formData.get("purchaseOrderId")));
  if (!order || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) return showToast("此採購單目前不可登記到貨", "error");
  let totalReceived = 0;
  order.lines.forEach((line) => {
    const remaining = Math.max(0, line.orderedQty - line.receivedQty);
    const receivedQty = Math.min(remaining, Math.max(0, toNumber(formData.get(`received_${line.id}`))));
    if (receivedQty) {
      line.receivedQty += receivedQty;
      totalReceived += receivedQty;
      const balance = getBalance("warehouse", line.productId);
      balance.onHandQty += receivedQty;
      state.data.demands.forEach((demand) => demand.items.forEach((item) => { if (line.sourceDemandIds?.includes(demand.id) && item.productId === line.productId) item.purchaseReceivedQty += receivedQty; }));
    }
  });
  const allReceived = order.lines.every((line) => line.receivedQty >= line.orderedQty);
  order.status = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
  order.lastReceivedAt = `${today} 14:30`;
  addAudit("採購到貨", "PURCHASE_ORDER", order.id, `${order.purchaseOrderNumber} 本次入庫 ${totalReceived} 件 · ${String(formData.get("receiveNotes") || "無備註")}`);
  saveData();
  closeModal();
  state.view = "receipts";
  showToast(`已將 ${totalReceived} 件採購到貨加入總倉庫存`, "success");
  render();
}

function addProduct(formData) {
  const productCodeValue = String(formData.get("productCode") || "").trim();
  const barcodeValue = String(formData.get("barcode") || "").trim();
  if (state.data.products.some((product) => product.productCode === productCodeValue || product.barcode === barcodeValue)) return showToast("商品編號或條碼已存在", "error");
  const productId = createId("product");
  const product = { id: productId, productCode: productCodeValue, barcode: barcodeValue, name: String(formData.get("name")), specification: String(formData.get("specification")), category: String(formData.get("category")), baseUnit: "件", supplierId: String(formData.get("supplierId")), isActive: true };
  state.data.products.push(product);
  state.data.supplierProducts.push({ id: createId("sp"), productId, supplierId: product.supplierId, supplierProductCode: `${productCodeValue}-S`, purchaseUnit: "件", purchaseMultiple: 1, minimumOrderQuantity: 1, purchasePrice: 0, isPrimary: true });
  state.data.inventory.push({ id: createId("balance"), locationId: "warehouse", productId, onHandQty: 0, reservedQty: 0, updatedAt: today });
  state.data.locations.filter((location) => location.type === "STORE").forEach((location) => { state.data.inventory.push({ id: createId("balance"), locationId: location.id, productId, onHandQty: 0, reservedQty: 0, updatedAt: today }); state.data.settings.push({ id: createId("setting"), locationId: location.id, productId, safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, storeDistributionMultiple: 1, automaticReplenishmentEnabled: false }); });
  addAudit("建立商品", "PRODUCT", productId, `${product.productCode} · ${product.name}`);
  saveData(); closeModal(); showToast("商品主檔已建立", "success"); render();
}

function adjustInventory(formData) {
  const locationId = String(formData.get("locationId"));
  const productId = String(formData.get("productId"));
  const balance = getBalance(locationId, productId);
  const before = balance.onHandQty;
  const after = Math.max(0, Math.floor(toNumber(formData.get("onHandQty"))));
  balance.onHandQty = after; balance.updatedAt = today;
  addAudit("人工調整庫存", "INVENTORY", balance.id, `${locationName(locationId)} · ${productName(productId)} · ${before} → ${after} 件 · ${String(formData.get("reason"))}`);
  saveData(); closeModal(); showToast("庫存調整已儲存", "success"); render();
}

function addUser(formData) {
  const username = String(formData.get("username") || "").trim();
  if (state.data.users.some((user) => user.username === username)) return showToast("帳號已存在", "error");
  const userId = createId("user");
  const user = { id: userId, username, displayName: String(formData.get("displayName")), role: String(formData.get("role")), locationId: String(formData.get("locationId")) || null, isActive: true, passwordHash: "" };
  if (user.role === "STORE" && !user.locationId) return showToast("STORE 使用者必須綁定門市", "error");
  state.data.users.push(user);
  addAudit("建立使用者", "USER", userId, `${user.username} · ${ROLE_LABELS[user.role]} · ${user.locationId ? locationName(user.locationId) : "全域"}`);
  saveData(); closeModal(); showToast("使用者已建立，首次登入前需設定本機示範密碼", "success"); render();
}

function toggleUser(userId) {
  const user = state.data.users.find((item) => item.id === userId);
  if (!user || user.id === currentUser().id) return;
  user.isActive = !user.isActive;
  addAudit(user.isActive ? "啟用使用者" : "停用使用者", "USER", user.id, `${user.displayName} · ${user.username}`);
  saveData(); showToast(user.isActive ? "使用者已啟用" : "使用者已停用", "success"); render();
}

function openModal(type, options = {}) { state.modal = { type, ...options }; render(); }
function closeModal() { state.modal = null; render(); }
function showToast(message, tone = "success") { state.toast = { message, tone }; window.setTimeout(() => { state.toast = null; document.querySelector(".toast")?.remove(); }, 2800); }

function modalTitle(type) { return { "create-demand": "新增人工需求", "demand-detail": "需求單詳情", "confirm-suggestion": "確認補貨建議", allocation: "建立總倉配貨單", "receive-allocation": "門市簽收", "receive-purchase": "採購到貨登記", "add-product": "新增商品主檔", "adjust-inventory": "人工調整庫存", "add-user": "新增使用者", profile: "個人登入資訊" }[type] || "操作"; }

function currentUser() { return state.data.users.find((user) => user.id === state.session?.userId) || null; }
function canView(view) { const role = currentUser()?.role; return view === "dashboard" || view === "demands" || (view === "replenishment" && ["ADMIN", "STORE"].includes(role)) || (view === "allocations" && ["ADMIN", "WAREHOUSE"].includes(role)) || (view === "purchasing" && ["ADMIN", "PURCHASING", "WAREHOUSE"].includes(role)) || (view === "receipts" && ["ADMIN", "STORE", "WAREHOUSE", "PURCHASING"].includes(role)) || (view === "masters" && role === "ADMIN") || (view === "users" && role === "ADMIN") || (view === "audit" && role === "ADMIN"); }
function visibleDemands() { const user = currentUser(); return state.data.demands.filter((demand) => user?.role !== "STORE" || demand.locationId === user.locationId); }
function visibleSuggestions() { const user = currentUser(); return state.data.replenishmentSuggestions.filter((item) => user?.role !== "STORE" || item.locationId === user.locationId); }
function visibleAllocations() { const user = currentUser(); return state.data.allocations.filter((item) => user?.role !== "STORE" || item.destinationLocationId === user.locationId); }
function canAccessDemand(demand) { return currentUser()?.role !== "STORE" || demand.locationId === currentUser()?.locationId; }
function getDemand(id) { return state.data.demands.find((demand) => demand.id === id); }
function demandNumber(id) { return getDemand(id)?.demandNumber || "—"; }
function demandTotals(demand) { return demand.items.reduce((totals, item) => ({ requested: totals.requested + toNumber(item.requestedQty), allocated: totals.allocated + toNumber(item.allocatedQty) + toNumber(item.receivedQty), shortage: totals.shortage + Math.max(0, demandOutstanding(item)) }), { requested: 0, allocated: 0, shortage: 0 }); }
function getBalance(locationId, productId) { let balance = state.data.inventory.find((item) => item.locationId === locationId && item.productId === productId); if (!balance) { balance = { id: createId("balance"), locationId, productId, onHandQty: 0, reservedQty: 0, updatedAt: today }; state.data.inventory.push(balance); } return balance; }
function getSetting(locationId, productId) { return state.data.settings.find((item) => item.locationId === locationId && item.productId === productId) || { safetyStockQty: 0, maximumStockQty: 0, minimumReplenishmentQty: 1, storeDistributionMultiple: 1, automaticReplenishmentEnabled: false }; }
function getSupplierProduct(productId, supplierId) { return state.data.supplierProducts.find((item) => item.productId === productId && item.supplierId === supplierId); }
function productName(id) { return state.data.products.find((product) => product.id === id)?.name || "未知商品"; }
function productCode(id) { return state.data.products.find((product) => product.id === id)?.productCode || "—"; }
function supplierName(id) { return state.data.suppliers.find((supplier) => supplier.id === id)?.name || "未指定供應商"; }
function supplierLeadTime(id) { return state.data.suppliers.find((supplier) => supplier.id === id)?.leadTimeDays || 0; }
function locationName(id) { return state.data.locations.find((location) => location.id === id)?.name || "未指定單位"; }
function userName(id) { return state.data.users.find((user) => user.id === id)?.displayName || "系統"; }
function demandTypeLabel(type) { return { GENERAL: "一般需求", URGENT: "急件", CUSTOMER_ORDER: "客訂", PROMOTION: "活動備貨", NEW_PRODUCT: "新品", OTHER: "其他" }[type] || type; }
function statusChip(status) { return `<span class="status-chip ${String(status).toLowerCase()}">${STATUS_LABELS[status] || status}</span>`; }
function emptyRow(colspan, text) { return `<tr><td colspan="${colspan}">${emptyState(text, "")}</td></tr>`; }
function emptyState(title, detail) { return `<div class="empty-state"><span>◌</span><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function renderToast() { return `<div class="toast ${state.toast.tone}"><span>${state.toast.tone === "error" ? "!" : "✓"}</span>${escapeHtml(state.toast.message)}</div>`; }
function addAudit(action, entityType, entityId, detail) { state.data.auditLogs.unshift({ id: createId("audit"), createdAt: `${today} 09:00`, userId: currentUser()?.id || "system", action, entityType, entityId, detail }); }
function nextNumber(prefix) { const stamp = today.replaceAll("-", "").slice(2); const count = prefix === "DN" ? state.data.demands.length + 1 : prefix === "AL" ? state.data.allocations.length + 1 : state.data.purchaseOrders.length + 1; return `${prefix}-${stamp}-${String(count).padStart(3, "0")}`; }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00+08:00`); date.setDate(date.getDate() + toNumber(days)); return date.toISOString().slice(0, 10); }
function allocationInTransit(locationId, productId) { return state.data.allocations.filter((item) => item.destinationLocationId === locationId && ["PICKING", "SHIPPED"].includes(item.status)).reduce((sum, allocation) => sum + allocation.items.filter((line) => line.productId === productId).reduce((lineSum, line) => lineSum + Math.max(0, line.shippedQty - line.receivedQty), 0), 0); }
function purchaseInbound(locationId, productId) { return 0; }
function existingOpenDemand(locationId, productId) { return state.data.demands.filter((demand) => demand.locationId === locationId && isOpenDemandStatus(demand.status)).reduce((sum, demand) => sum + demand.items.filter((item) => item.productId === productId).reduce((itemSum, item) => itemSum + demandOutstanding(item), 0), 0); }
function demandCount() { return visibleDemands().filter((item) => isOpenDemandStatus(item.status)).length; }
function pendingSuggestionCount() { return visibleSuggestions().filter((item) => item.status === "PENDING").length; }
function allocationCount() { return state.data.allocations.filter((item) => item.status === "PICKING").length; }
function purchaseGapCount() { const seen = new Set(); state.data.demands.forEach((demand) => demand.items.forEach((item) => { if (purchaseCoverage(item) > 0) seen.add(item.productId); })); return seen.size; }
function receiptCount() { return visibleAllocations().filter((item) => item.status === "SHIPPED").length; }
function pendingPurchaseQty() { return state.data.purchaseOrders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + Math.max(0, line.orderedQty - line.receivedQty), 0), 0); }
function receivedPurchaseQty() { return state.data.purchaseOrders.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.receivedQty, 0), 0); }
function totalWarehouseAvailable() { return state.data.inventory.filter((item) => item.locationId === "warehouse").reduce((sum, item) => sum + availableInventory(item), 0); }
function warehouseSkuCount() { return state.data.inventory.filter((item) => item.locationId === "warehouse" && availableInventory(item) > 0).length; }
function buildAttentionItems(user) { const items = []; if (user.role === "STORE") { if (pendingSuggestionCount()) items.push({ icon: "↻", title: `${pendingSuggestionCount()} 筆自動補貨建議待確認`, detail: "確認後才會轉成正式需求", view: "replenishment", tone: "violet" }); if (receiptCount()) items.push({ icon: "✓", title: `${receiptCount()} 張配貨單待簽收`, detail: "簽收後會增加門市庫存", view: "receipts", tone: "amber" }); } else if (user.role === "WAREHOUSE") { const queue = state.data.demands.filter((item) => ["SUBMITTED", "APPROVED"].includes(item.status)).length; if (queue) items.push({ icon: "⇥", title: `${queue} 張需求等待配貨`, detail: "依總倉可用量建立配貨單", view: "allocations", tone: "blue" }); if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項缺口待採購`, detail: "已配不足的數量會保留追蹤", view: "purchasing", tone: "red" }); } else if (user.role === "PURCHASING") { if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項商品待建立採購單`, detail: "依供應商 MOQ 與倍數處理", view: "purchasing", tone: "red" }); if (pendingPurchaseQty()) items.push({ icon: "↓", title: `${numberLabel(pendingPurchaseQty())} 件採購品項未到貨`, detail: "可登記部分到貨", view: "receipts", tone: "amber" }); } else { if (demandCount()) items.push({ icon: "▤", title: `${demandCount()} 張需求尚未結案`, detail: "跨門市需求池等待處理", view: "demands", tone: "blue" }); if (purchaseGapCount()) items.push({ icon: "◫", title: `${purchaseGapCount()} 項採購缺口`, detail: "查看跨門市缺口彙總", view: "purchasing", tone: "red" }); } return items.slice(0, 4); }
function workflowProgress() { const total = state.data.demands.length || 1; const completed = state.data.demands.filter((item) => item.status === "COMPLETED").length; return Math.round((completed / total) * 100); }

