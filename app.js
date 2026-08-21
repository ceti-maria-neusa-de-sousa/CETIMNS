import { supabase, fetchWithCache, clearCache } from "./supabase.js";

console.log("App carregado!");
console.log("Supabase:", supabase);

const SESSION_KEY = "ceti_admin_session";
const SCHOOL_LOGO = "logo-ceti.png";
const SCHOOL_TITLE = "CETI Maria Neusa de Sousa";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_SIZE = 25 * 1024 * 1024;
const DEFAULT_STUDENT_PASSWORD = "1234";
const makeId = () => crypto.randomUUID();
const normalizeUser = (value) => String(value ?? "").trim().toLowerCase();
const normalizePassword = (value) => String(value ?? "").trim();
const idsEqual = (left, right) => String(left ?? "") === String(right ?? "");

let state = {
  classes: [],
  subjects: [],
  students: [],
  teachers: [],
  teacherAssignments: [],
  grades: [],
  news: [],
  events: [],
  activities: [],
  achievements: [],
  files: [],
  indicators: {
    students: 0,
    projects: 0,
    events: 0,
    awards: 0
  },
  about: {
    history: "",
    mission: "",
    vision: "",
    values: ""
  },
  contact: {
    address: "",
    phone: "",
    email: ""
  },
  team: []
};

let currentCalendarView = "month";
let currentCalendarDate = new Date();
let currentAdminTab = "dashboard";
let currentAdminContentTab = "news";
let currentTeacherTrimester = "1";
let currentTeacherSubject = "";
let currentTeacherClass = "";
let currentStudentView = "bulletin";
let isRefreshingData = false;
let adminEditState = {
  classId: null,
  subjectId: null,
  studentId: null,
  teacherId: null,
  gradeId: null,
  contentId: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const normalizeLabel = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const parseCsvText = (text) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""));
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
};

const parseFileClassName = (fileName) => {
  const base = String(fileName ?? "").replace(/\.csv$/i, "").trim();
  if (!base) return "";
  let className = base.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  className = className.replace(/^(turma|class)\s*/i, "").trim();
  return className;
};

const createStudentUsername = (name, existingUsernames = new Set(), preferredUser = "") => {
  const preferred = normalizeUser(preferredUser || "");
  const firstName = normalizeUser(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .find(Boolean);
  const base = preferred || firstName || "aluno";
  let user = base || `aluno${Math.floor(Math.random() * 100000)}`;
  let counter = 1;
  while (existingUsernames.has(user) || !user) {
    user = `${base || "aluno"}${counter++}`;
  }
  existingUsernames.add(user);
  return user;
};

const parseStudentCsvRows = (text, fallbackClassName = "") => {
  const rows = parseCsvText(text);
  return rows
    .map((row) => {
      const className = String(row.classname || row.className || row.turma || "").trim() || fallbackClassName;
      return {
        name: String(row.name || row.nome || "").trim(),
        className: className.trim(),
        user: String(row.user || "").trim() || null
      };
    })
    .filter((row) => row.name && row.className);
};

// ==================== FUNÇÕES DE CÁLCULO ====================
function calculateTrimesterRecovery(n1, n2, n3) {
  const n1Num = Number(n1) || 0;
  const n2Num = Number(n2) || 0;
  const n3Num = Number(n3) || 0;
  
  if (n1Num === 0 && n2Num === 0 && n3Num === 0) return false;
  
  const average = (n1Num + n2Num + n3Num) / 3;
  return average < 6;
}

function getTrimesterAverage(n1, n2, n3) {
  const n1Num = Number(n1) || 0;
  const n2Num = Number(n2) || 0;
  const n3Num = Number(n3) || 0;
  
  if (n1Num === 0 && n2Num === 0 && n3Num === 0) return "0.0";
  
  return ((n1Num + n2Num + n3Num) / 3).toFixed(1);
}

function normalizeTrimester(trimester = {}) {
  const n1 = Number(trimester.n1) || 0;
  const n2 = Number(trimester.n2) || 0;
  const n3 = Number(trimester.n3) || 0;
  const recoveryScore = Number(trimester.recoveryScore) || 0;
  const recovery = calculateTrimesterRecovery(n1, n2, n3);
  
  return { n1, n2, n3, recovery, recoveryScore };
}

function getTrimester(grade = {}, trimester = "1") {
  return normalizeTrimester(grade.trimesters?.[trimester]);
}

function trimesterAverage(grade, trimester = "1") {
  const tri = getTrimester(grade, trimester);
  return getTrimesterAverage(tri.n1, tri.n2, tri.n3);
}

function getTrimesterRegularAverage(grade, trimester = "1") {
  const tri = getTrimester(grade, trimester);
  return Number(getTrimesterAverage(tri.n1, tri.n2, tri.n3)) || 0;
}

function getTrimesterRecoveryScore(grade, trimester = "1") {
  const tri = getTrimester(grade, trimester);
  return Number(tri.recoveryScore) || 0;
}

function getTrimesterFinalAverage(grade, trimester = "1") {
  const regular = getTrimesterRegularAverage(grade, trimester);
  const recoveryScore = getTrimesterRecoveryScore(grade, trimester);
  const finalAverage = recoveryScore > 0 ? Math.max(regular, recoveryScore) : regular;
  return finalAverage.toFixed(1);
}

function gradeAverage(grade) {
  const t1 = Number(getTrimesterFinalAverage(grade, "1")) || 0;
  const t2 = Number(getTrimesterFinalAverage(grade, "2")) || 0;
  const t3 = Number(getTrimesterFinalAverage(grade, "3")) || 0;
  
  if (t1 === 0 && t2 === 0 && t3 === 0) return "0.0";
  
  let count = 0;
  let sum = 0;
  if (t1 > 0) { sum += t1; count++; }
  if (t2 > 0) { sum += t2; count++; }
  if (t3 > 0) { sum += t3; count++; }
  
  return count > 0 ? (sum / count).toFixed(1) : "0.0";
}

function hasAllGrades(studentId) {
  const studentGrades = state.grades.filter((g) => g.studentId === studentId);
  return studentGrades.every(
    (g) =>
      getTrimesterFinalAverage(g, "1") !== "0.0" &&
      getTrimesterFinalAverage(g, "2") !== "0.0" &&
      getTrimesterFinalAverage(g, "3") !== "0.0"
  );
}

// ==================== FUNÇÕES DE DADOS ====================
async function loadDataFromSupabase({ useCache = false, forceNetwork = false } = {}) {
  try {
    if (isRefreshingData) return false;
    isRefreshingData = true;
    console.log("Carregando dados do Supabase...");

    const loadTable = (table, transform, optional) => {
      const request = () => safeTableSelect(table, transform, optional);
      return useCache ? fetchWithCache(table, "all", request, { force: forceNetwork }) : request();
    };
    const [classesData, subjectsData, studentsData, teachersData, teacherAssignmentsData, gradesData, newsData, eventsData, activitiesData, achievementsData, configData] = await Promise.all([
      loadTable("classes"),
      loadTable("subjects"),
      loadTable("students"),
      loadTable("teachers"),
      loadTable("teacher_assignments", undefined, true),
      loadTable("grades"),
      loadTable("news"),
      loadTable("events"),
      loadTable("activities"),
      loadTable("achievements"),
      loadTable("school_config", (query) => query.order("created_at", { ascending: false }).limit(1))
    ]);

    state.classes = (classesData || [])
      .map((item) => ({ ...item, name: item.name || "" }))
      .filter((item) => item.name);
    state.subjects = (subjectsData || [])
      .map((item) => ({ ...item, name: item.name || "" }))
      .filter((item) => item.name);
    state.students = (studentsData || []).map(normalizeStudentData);
    state.teachers = (teachersData || []).map(normalizeTeacherData);
    state.teacherAssignments = (teacherAssignmentsData || []).map(normalizeTeacherAssignmentData);
    state.grades = (gradesData || []).map(normalizeGradeData);
    state.news = newsData || [];
    state.events = eventsData || [];
    state.activities = activitiesData || [];
    state.achievements = achievementsData || [];
    const config = configData?.[0];
    if (config) {
      state.about.history = config.history || "";
      state.about.mission = config.mission || "";
      state.about.vision = config.vision || "";
      state.about.values = config.values || config["values"] || "";
      state.contact.address = config.address || "";
      state.contact.phone = config.phone || "";
      state.contact.email = config.email || "";
      state.team = Array.isArray(config.team) ? config.team : [];
    }

    state.indicators = {
      students: state.students.length,
      projects: state.activities.length,
      events: state.events.length,
      awards: state.achievements.length
    };

    console.log("Dados carregados com sucesso");
    return true;
  } catch (error) {
    console.error("Erro ao carregar dados do Supabase:", error);
    return false;
  } finally {
    isRefreshingData = false;
  }
}

async function safeTableSelect(table, transform, optional = false) {
  try {
    const query = supabase.from(table).select("*");
    const result = transform ? await transform(query) : await query;
    if (result.error) throw result.error;
    return result.data || [];
  } catch (error) {
    if (!optional) console.error(`Erro ao buscar ${table}:`, error);
    return [];
  }
}

function normalizeStudentData(student = {}) {
  return {
    ...student,
    className: student.className || student.classname || "",
    user: student.user || "",
    password: student.password || "",
    isJournalist: Boolean(student.is_journalist ?? student.isJournalist)
  };
}

function normalizeTeacherData(teacher = {}) {
  const classes = Array.isArray(teacher.classes)
    ? teacher.classes
    : typeof teacher.classes === "string"
    ? parseCommaList(teacher.classes)
    : Array.isArray(teacher.classnames)
    ? teacher.classnames
    : typeof teacher.classnames === "string"
    ? parseCommaList(teacher.classnames)
    : teacher.className
    ? [teacher.className]
    : [];
  const subjects = parseTeacherSubjectList(teacher.subjects || teacher.subject || teacher.subjectname);

  return {
    ...teacher,
    subject: teacher.subject || teacher.subjectname || "",
    subjects,
    classes
  };
}

function normalizeTeacherAssignmentData(assignment = {}) {
  return {
    ...assignment,
    teacherId: assignment.teacherId || assignment.teacher_id || "",
    subject: assignment.subject || assignment.subjectname || "",
    className: assignment.className || assignment.classname || ""
  };
}

function normalizeGradeData(grade) {
  const trimesters = grade.trimesters || { 
    1: { n1: 0, n2: 0, n3: 0 }, 
    2: { n1: 0, n2: 0, n3: 0 }, 
    3: { n1: 0, n2: 0, n3: 0 } 
  };
  
  return {
    ...grade,
    studentId: grade.studentId || grade.studentid || grade.student_id || "",
    subject: grade.subject || grade.subjectname || "",
    className: grade.className || grade.classname || grade.Name || "",
    trimesters: {
      1: normalizeTrimester(trimesters[1]),
      2: normalizeTrimester(trimesters[2]),
      3: normalizeTrimester(trimesters[3])
    }
  };
}

async function saveGradeToSupabase(grade) {
  try {
    const gradePayload = {
      ...grade,
      studentId: grade.studentId,
      subject: grade.subject,
      className: grade.className
    };
    // A tabela publicada usa os nomes em camelCase. Remova possíveis aliases
    // recebidos de versões antigas para que o Supabase não rejeite o registro.
    delete gradePayload.studentid;
    delete gradePayload.student_id;
    delete gradePayload.classname;
    const { error } = await supabase
      .from("grades")
      .upsert(gradePayload, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("grades");
  } catch (error) {
    console.error("Erro ao salvar nota:", error);
  }
}

async function saveGradesToSupabase(grades) {
  const gradePayloads = grades.map((grade) => {
    const payload = {
      ...grade,
      studentId: grade.studentId,
      subject: grade.subject,
      className: grade.className
    };
    delete payload.studentid;
    delete payload.student_id;
    delete payload.classname;
    return payload;
  });
  const { data, error } = await supabase
    .from("grades")
    .upsert(gradePayloads, { onConflict: "id" })
    .select();
  if (error) throw error;
  clearCache("grades");
  return (data || []).map(normalizeGradeData);
}

function isValidGradeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 10;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${date}T12:00:00`));
}

function getClassLabel(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";
  const match = state.classes.find(
    (item) => normalizeLabel(item?.id) === normalizeLabel(rawValue) || normalizeLabel(item?.name) === normalizeLabel(rawValue)
  );
  return match?.name || rawValue;
}

function getSubjectLabel(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";
  const match = state.subjects.find(
    (item) => normalizeLabel(item?.id) === normalizeLabel(rawValue) || normalizeLabel(item?.name) === normalizeLabel(rawValue)
  );
  return match?.name || rawValue;
}

function parseTeacherSubjectList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => getSubjectLabel(item)).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[,;\n]/)
    .map((item) => getSubjectLabel(item))
    .filter(Boolean);
}

function getTeacherAssignments(teacher) {
  const teacherId = typeof teacher === "string" ? teacher : teacher?.id;
  if (!teacherId) return [];
  return state.teacherAssignments.filter((assignment) => normalizeLabel(assignment.teacherId) === normalizeLabel(teacherId));
}

function getTeacherSubjects(teacher) {
  const assignments = getTeacherAssignments(teacher);
  if (assignments.length) {
    return [...new Set(assignments.map((assignment) => getSubjectLabel(assignment.subject)).filter(Boolean))];
  }
  const source = Array.isArray(teacher?.subjects) && teacher.subjects.length ? teacher.subjects : teacher?.subject;
  return [...new Set(parseTeacherSubjectList(source))];
}

function getTeacherClasses(teacher) {
  const assignments = getTeacherAssignments(teacher);
  if (assignments.length) {
    return [...new Set(assignments.map((assignment) => getClassLabel(assignment.className)).filter(Boolean))];
  }
  return (teacher?.classes || []).map((className) => getClassLabel(className)).filter(Boolean);
}

function getTeacherSubjectClassPairs(teacher) {
  const assignments = getTeacherAssignments(teacher);
  if (assignments.length) {
    return assignments
      .map((assignment) => ({
        subject: getSubjectLabel(assignment.subject),
        className: getClassLabel(assignment.className)
      }))
      .filter((item) => item.subject && item.className);
  }

  const subjects = getTeacherSubjects(teacher);
  const classes = getTeacherClasses(teacher);
  return subjects.flatMap((subject) => classes.map((className) => ({ subject, className })));
}

function getValidClassesForTeacherSubject(teacher, subject) {
  const normalizedSubject = getSubjectLabel(subject);
  const pairs = getTeacherSubjectClassPairs(teacher);
  const classes = pairs.filter((pair) => getSubjectLabel(pair.subject) === normalizedSubject).map((pair) => pair.className);
  return [...new Set(classes)];
}

function getValidSubjectsForTeacherClass(teacher, className) {
  const normalizedClass = getClassLabel(className);
  const pairs = getTeacherSubjectClassPairs(teacher);
  const subjects = pairs.filter((pair) => getClassLabel(pair.className) === normalizedClass).map((pair) => pair.subject);
  return [...new Set(subjects)];
}

function getTeachersForClass(className) {
  const label = getClassLabel(className);
  if (!label) return [];
  const normalizedLabel = normalizeLabel(label);
  return state.teachers.filter((teacher) => getTeacherClasses(teacher).some((item) => normalizeLabel(item) === normalizedLabel));
}

function getSubjectsForClass(className) {
  return [
    ...new Set(
      getTeachersForClass(className)
        .flatMap((teacher) => getValidSubjectsForTeacherClass(teacher, className))
        .filter(Boolean)
    )
  ];
}

function formatTeacherAssignments(teacher) {
  return getTeacherSubjectClassPairs(teacher)
    .map((pair) => `${pair.subject} → ${pair.className}`)
    .join("; ");
}

async function replaceTeacherAssignments(teacherId, assignments) {
  const removed = await supabase.from("teacher_assignments").delete().eq("teacher_id", teacherId);
  if (removed.error) throw removed.error;
  if (!assignments.length) return;
  const rows = assignments.map(({ subject, className }) => ({
    teacher_id: teacherId,
    subject,
    classname: className
  }));
  const inserted = await supabase.from("teacher_assignments").insert(rows);
  if (inserted.error) throw inserted.error;
  clearCache("teacher_assignments");
}

function getStudentClassInfo(student) {
  const classLabel = getClassLabel(student?.className);
  return {
    classLabel,
    teachers: getTeachersForClass(classLabel),
    subjects: getSubjectsForClass(classLabel)
  };
}

function renderClassLinkInfo(className) {
  const info = getStudentClassInfo({ className });
  if (!info.classLabel) {
    return `<p class="muted">Selecione uma turma para ver o professor e a disciplina vinculados automaticamente.</p>`;
  }

  return `
    <strong>Vínculo automático da turma: ${escapeHtml(info.classLabel)}</strong>
    <p class="muted">Professor(es): ${info.teachers.map((teacher) => escapeHtml(teacher.name)).join(", ") || "Não vinculado"}</p>
    <p class="muted">Disciplina(s): ${info.subjects.map(escapeHtml).join(", ") || "Não vinculada"}</p>
  `;
}

function hasTrimesterScores(grade, trimester) {
  const data = getTrimester(grade, trimester);
  return [data.n1, data.n2, data.n3].some((value) => Number(value) > 0);
}

function getTrimesterStatusText(grade, trimester) {
  const data = getTrimester(grade, trimester);
  const regularAverage = getTrimesterRegularAverage(grade, trimester);
  const finalAverage = Number(getTrimesterFinalAverage(grade, trimester));
  const recoveryScore = getTrimesterRecoveryScore(grade, trimester);
  if (trimester === "3") {
    if (!hasTrimesterScores(grade, "3")) {
      return "Pendente";
    }
    return finalAverage >= 6 ? "Aprovado" : "Recuperação final";
  }
  if (!hasTrimesterScores(grade, trimester)) return "Pendente";
  if (finalAverage >= 6) return "Aprovado";
  return regularAverage < 6 || recoveryScore > 0 ? "Recuperação" : "Lançado";
}

function getGradeSnapshot(grade, trimester, values = {}) {
  const snapshot = {
    ...grade,
    trimesters: {
      1: { ...normalizeTrimester(grade.trimesters?.[1]) },
      2: { ...normalizeTrimester(grade.trimesters?.[2]) },
      3: { ...normalizeTrimester(grade.trimesters?.[3]) }
    }
  };

  snapshot.trimesters[trimester] = {
    n1: values.n1 ?? snapshot.trimesters[trimester].n1,
    n2: values.n2 ?? snapshot.trimesters[trimester].n2,
    n3: values.n3 ?? snapshot.trimesters[trimester].n3,
    recovery: calculateTrimesterRecovery(values.n1 ?? snapshot.trimesters[trimester].n1, values.n2 ?? snapshot.trimesters[trimester].n2, values.n3 ?? snapshot.trimesters[trimester].n3),
    recoveryScore: values.recoveryScore ?? snapshot.trimesters[trimester].recoveryScore ?? 0
  };

  return snapshot;
}

function route() {
  let page = (location.hash || "#inicio").replace("#", "").split("?")[0];
  if (page === "top") page = "inicio";
  $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.route === page));
  $("[data-nav-panel]").classList.remove("open");
  document.body.classList.remove("no-scroll");
  $("#main").focus({ preventScroll: true });
  if ((location.hash || "").replace("#", "").split("?")[0] === "top") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (page === "login") renderLoginPortal();
  if (page === "noticia") renderNewsDetail();
}

function toast(message) {
  const region = $("[data-toast-region]");
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 3200);
}

function card(item, type, options = {}) {
  const title = item.title || item.name;
  const text = item.summary || item.description || item.content;
  const category = item.category || item.responsible || type;
  const media = item.files?.find((file) => file.type?.startsWith("image/") || file.type?.startsWith("video/"));
  const mediaMarkup = media?.type?.startsWith("image/")
    ? `<img class="card-media" src="${media.data}" alt="">`
    : media?.type?.startsWith("video/") && !options.href
    ? `<video class="card-media" controls preload="metadata"><source src="${media.data}" type="${escapeHtml(media.type)}"></video>`
    : `<div class="card-media">${category}</div>`;
  const downloads = !options.href
    ? (item.files || []).filter((file) => !file.type?.startsWith("image/") && !file.type?.startsWith("video/")).map(newsAttachment).join("")
    : "";
  const openLabel = options.href ? `<span class="card-link-label">Ler noticia completa</span>` : "";
  const content = `
    ${mediaMarkup}
    <div class="card-body">
      <span class="badge">${escapeHtml(category)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(text)}</p>
      ${item.date ? `<p class="meta">${formatDate(item.date)}</p>` : ""}
      ${downloads ? `<div class="card-attachments">${downloads}</div>` : ""}
      ${openLabel}
    </div>
  `;
  if (options.href) {
    return `<a class="card card-link" href="${options.href}" aria-label="Abrir noticia completa: ${escapeHtml(title)}">${content}</a>`;
  }
  return `
    <article class="card">
      ${content}
    </article>
  `;
}

// ==================== RENDERIZAÇÃO PÚBLICA ====================
function renderPublic() {
  renderHome();
  renderNews();
  renderAbout();
  renderContact();
  renderCalendar();
  renderActivities();
  renderAchievements();
  setupFilters();
}

function renderHome() {
  const published = getPublishedNews();
  const nextEvents = [...state.events].filter((item) => item.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  $("[data-home-highlights]").innerHTML = [
    published[0] && card(published[0], "Últimas notícias"),
    nextEvents[0] && card(nextEvents[0], "Próximos eventos"),
    card({ title: "Calendário escolar", summary: "Acompanhe provas, reuniões e datas importantes.", category: "Organização" }, "Calendário"),
    state.activities[0] && card(state.activities[0], "Atividades Recentes")
  ]
    .filter(Boolean)
    .join("");

  const indicators = [
    ["Alunos", state.indicators.students],
    ["Projetos realizados", state.indicators.projects],
    ["Eventos realizados", state.indicators.events],
    ["Premiações", state.indicators.awards]
  ];
  $("[data-indicators]").innerHTML = indicators
    .map(([label, value]) => `<article class="stat-card"><strong>${value}</strong><span>${label}</span></article>`)
    .join("");

  const galleryItems = [
    ...published.map((item) => ({ ...item, galleryType: "news" })),
    ...state.activities.map((item) => ({ ...item, galleryType: "activity" })),
    ...state.achievements.map((item) => ({ ...item, galleryType: "achievement" }))
  ]
    .flatMap((item) => (item.files || [])
      .filter((file) => file.type?.startsWith("image/") && file.data)
      .map((file) => ({ item, file })))
    .slice(0, 8);
  $("[data-gallery-strip]").innerHTML = galleryItems.length
    ? galleryItems.map(({ item, file }) => {
        const title = item.title || item.name || "Registro da escola";
        const content = `<img src="${file.data}" alt="${escapeHtml(title)}" loading="lazy"><span>${escapeHtml(title)}</span>`;
        return item.galleryType === "news"
          ? `<a class="gallery-item" href="#noticia?id=${encodeURIComponent(item.id)}">${content}</a>`
          : `<figure class="gallery-item">${content}</figure>`;
      }).join("")
    : `<div class="gallery-empty"><strong>Galeria da escola</strong><p class="muted">As imagens publicadas em notícias, atividades e conquistas aparecerão aqui.</p></div>`;
}

function renderNews() {
  const categories = ["Todas", ...new Set(state.news.map((item) => item.category).filter(Boolean))];
  $("[data-category-filter='noticias']").innerHTML = categories.map((cat) => `<option>${cat}</option>`).join("");
  const items = getPublishedNews();
  $("[data-news-list]").innerHTML =
    items.map((item) => card(item, "Notícia", { href: `#noticia?id=${encodeURIComponent(item.id)}` })).join("") ||
    emptyState("Nenhuma notícia publicada.");
}

function getPublishedNews() {
  return state.news
    .filter((item) => item.published === true)
    .sort((a, b) => String(b.date || b.created_at || "").localeCompare(String(a.date || a.created_at || "")));
}

function renderNewsDetail() {
  const root = $("[data-news-detail]");
  if (!root) return;
  const params = new URLSearchParams((location.hash.split("?")[1] || "").trim());
  const item = state.news.find((news) => idsEqual(news.id, params.get("id")) && news.published === true);
  if (!item) {
    root.innerHTML = `
      <article class="panel news-detail">
        <a class="button ghost" href="#noticias">Voltar para notícias</a>
        <h2>Notícia não encontrada</h2>
        <p class="muted">A publicação pode ter sido removida ou ainda não está publicada.</p>
      </article>
    `;
    return;
  }
  const image = item.files?.find((file) => file.type.startsWith("image/"));
  const attachments = (item.files || []).filter((file) => !file.type.startsWith("image/"));
  root.innerHTML = `
    <article class="panel news-detail">
      <a class="button ghost" href="#noticias">Voltar para notícias</a>
      ${image ? `<img class="news-detail-media" src="${image.data}" alt="">` : ""}
      <div class="news-detail-head">
        <span class="badge">${escapeHtml(item.category || "Notícia")}</span>
        <h2>${escapeHtml(item.title)}</h2>
        <p class="meta">${item.date ? formatDate(item.date) : ""}${item.author ? ` | ${escapeHtml(item.author)}` : ""}</p>
      </div>
      ${item.summary ? `<p class="news-summary">${escapeHtml(item.summary)}</p>` : ""}
      <div class="news-content">${escapeHtml(item.content || item.summary || "").replaceAll("\n", "<br>")}</div>
      ${
        attachments.length
          ? `<div class="news-attachments"><h3>Anexos</h3>${attachments.map(newsAttachment).join("")}</div>`
          : ""
      }
    </article>
  `;
}

function newsAttachment(file) {
  if (file.type?.startsWith("video/")) {
    return `<video class="attachment-video" controls preload="metadata"><source src="${file.data}" type="${escapeHtml(file.type)}">Seu navegador não suporta este vídeo.</video>`;
  }
  return `<a class="button ghost" href="${file.data}" download="${escapeHtml(file.name)}">${escapeHtml(file.name)}</a>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || "application/octet-stream", size: file.size, data: reader.result });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function readAttachments(fileList, existingFiles = []) {
  const files = [...fileList];
  if (!files.length) return existingFiles;
  const oversized = files.find((file) => file.size > MAX_ATTACHMENT_SIZE);
  if (oversized) throw new Error(`O arquivo ${oversized.name} ultrapassa 10 MB.`);
  const totalSize = existingFiles.reduce((total, file) => total + Number(file.size || 0), 0) + files.reduce((total, file) => total + file.size, 0);
  if (totalSize > MAX_ATTACHMENTS_TOTAL_SIZE) throw new Error("Os anexos ultrapassam o limite total de 25 MB.");
  return [...existingFiles, ...(await Promise.all(files.map(fileToDataUrl)))];
}

function attachmentEditor(files = []) {
  if (!files.length) return `<p class="muted">Nenhum arquivo selecionado.</p>`;
  return files.map((file, index) => `<div class="attachment-item"><span>${escapeHtml(file.name || `Arquivo ${index + 1}`)}</span><button class="button ghost" type="button" data-remove-attachment="${index}">Remover</button></div>`).join("");
}

function renderAbout() {
  $("[data-about-history]").textContent = state.about.history;
  $("[data-about-mission]").textContent = state.about.mission;
  $("[data-about-vision]").textContent = state.about.vision;
  $("[data-about-values]").textContent = state.about.values;
  $("[data-team-list]").innerHTML = state.team
    .map((person) => `<div class="person"><strong>${person.name}</strong><br><span class="muted">${person.role}</span></div>`)
    .join("");
}

function renderContact() {
  $("[data-contact-address]").textContent = state.contact.address;
  $("[data-contact-phone]").textContent = state.contact.phone;
  $("[data-contact-email]").textContent = state.contact.email;
}

function renderCalendar() {
  const shell = $("[data-calendar]");
  $$('[data-calendar-view]').forEach((button) => button.classList.toggle("active", button.dataset.calendarView === currentCalendarView));
  const sortedEvents = [...state.events].filter((item) => item.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (currentCalendarView === "list") {
    shell.innerHTML = `<div class="list-view">${sortedEvents.map(calendarListItem).join("") || emptyState("Nenhum evento cadastrado.")}</div>`;
    return;
  }

  const days = currentCalendarView === "week" ? 7 : 42;
  const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  const base = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), currentCalendarView === "week" ? currentCalendarDate.getDate() : 1);
  const start = new Date(base);
  start.setDate(base.getDate() - start.getDay());
  const cells = Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const events = sortedEvents.filter((event) => String(event.date).slice(0, 10) === iso);
    const outsideMonth = currentCalendarView === "month" && date.getMonth() !== currentCalendarDate.getMonth();
    return `<div class="calendar-cell${outsideMonth ? " outside-month" : ""}"><strong>${date.getDate()}</strong>${events
      .map((event) => `<div class="calendar-event" title="${escapeHtml(event.description || "")}">${escapeHtml(event.title)}${event.time ? `<small>${escapeHtml(event.time)}</small>` : ""}</div>`)
      .join("")}</div>`;
  });
  const periodLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(currentCalendarDate);
  shell.innerHTML = `<div class="calendar-toolbar"><button class="button ghost" type="button" data-calendar-previous aria-label="Período anterior">←</button><strong>${escapeHtml(periodLabel)}</strong><button class="button ghost" type="button" data-calendar-next aria-label="Próximo período">→</button></div><div class="calendar-grid">${labels
    .map((label) => `<div class="calendar-head">${label}</div>`)
    .join("")}${cells.join("")}</div><div class="calendar-upcoming"><h3>Próximos eventos cadastrados</h3><div class="list-view">${sortedEvents.slice(0, 6).map(calendarListItem).join("") || emptyState("Nenhum evento cadastrado.")}</div></div>`;

  $("[data-calendar-previous]", shell).addEventListener("click", () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + (currentCalendarView === "month" ? -1 : 0), currentCalendarDate.getDate() + (currentCalendarView === "week" ? -7 : 0));
    renderCalendar();
  });
  $("[data-calendar-next]", shell).addEventListener("click", () => {
    currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + (currentCalendarView === "month" ? 1 : 0), currentCalendarDate.getDate() + (currentCalendarView === "week" ? 7 : 0));
    renderCalendar();
  });
}

function calendarListItem(event) {
  return `
    <article class="list-item">
      <strong>${formatDate(event.date)}<br>${event.time || ""}</strong>
      <div>
        <h3>${event.title}</h3>
        <p class="muted">${escapeHtml(event.description || "")}</p>
        ${event.location ? `<span class="badge">${escapeHtml(event.location)}</span>` : ""}
      </div>
    </article>
  `;
}

function renderActivities() {
  $("[data-activity-list]").innerHTML = state.activities.map((item) => card(item, "Atividade")).join("") || emptyState("Nenhuma atividade cadastrada.");
}

function renderAchievements() {
  const categories = ["Todas", ...new Set(state.achievements.map((item) => item.category).filter(Boolean))];
  $("[data-category-filter='conquistas']").innerHTML = categories.map((cat) => `<option>${cat}</option>`).join("");
  $("[data-achievement-list]").innerHTML =
    state.achievements.map((item) => card(item, "Conquista")).join("") || emptyState("Nenhuma conquista cadastrada.");
}

function emptyState(message) {
  return `<article class="panel"><p class="muted">${message}</p></article>`;
}

function setupFilters() {
  $$(".toolbar").forEach((toolbar) => {
    toolbar.oninput = toolbar.onchange = () => {
      const input = $("input", toolbar);
      const select = $("select", toolbar);
      const term = input?.value.toLowerCase() || "";
      const category = select?.value || "Todas";
      const key = input?.dataset.filter;
      const target =
        key === "noticias" ? "[data-news-list]" : key === "atividades" ? "[data-activity-list]" : "[data-achievement-list]";
      const collection = key === "noticias" ? getPublishedNews() : key === "atividades" ? state.activities : state.achievements;
      const filtered = collection.filter((item) => {
        const text = JSON.stringify(item).toLowerCase();
        const okCategory = category === "Todas" || !category || item.category === category;
        return text.includes(term) && okCategory;
      });
      $(target).innerHTML =
        filtered
          .map((item) =>
            key === "noticias" ? card(item, key, { href: `#noticia?id=${encodeURIComponent(item.id)}` }) : card(item, key)
          )
          .join("") || emptyState("Nenhum resultado encontrado.");
    };
  });
}

// ==================== AUTENTICAÇÃO ====================
function getSession() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

async function findLogin(user, password) {
  try {
    const username = normalizeUser(user);
    const secret = normalizePassword(password);

    const { data: admins } = await supabase
      .from("admins")
      .select("*")
      .ilike("user", username)
      .eq("password", secret);
    if (admins?.length) return { role: "admin", name: "Administrador", id: admins[0].id };

    const { data: teachers } = await supabase
      .from("teachers")
      .select("*")
      .ilike("user", username)
      .eq("password", secret);
    if (teachers?.length) return { role: "teacher", id: teachers[0].id, name: teachers[0].name };

    const { data: students } = await supabase
      .from("students")
      .select("*")
      .ilike("user", username)
      .eq("password", secret);
    if (students?.length) return {
      role: "student",
      id: students[0].id,
      name: students[0].name,
      mustChangePassword: Boolean(students[0].must_change_password)
    };

    if (username === "admin" && secret === "cetimns26") {
      return { role: "admin", name: "Administrador", id: "local-admin-fallback" };
    }

    return null;
  } catch (error) {
    console.error("Erro ao buscar login:", error);
    const username = normalizeUser(user);
    const secret = normalizePassword(password);
    if (username === "admin" && secret === "cetimns26") {
      return { role: "admin", name: "Administrador", id: "local-admin-fallback" };
    }
    return null;
  }
}

// ==================== PORTAL DE LOGIN ====================
function renderLoginPortal() {
  try {
    const session = getSession();
    if (session?.role === "admin") {
      renderAdmin();
      return;
    }
    if (session?.role === "teacher") {
      renderTeacherPanel(session);
      return;
    }
    if (session?.role === "student") {
      if (session.mustChangePassword) {
        renderStudentPasswordChange(session);
        return;
      }
      renderStudentPanel(session);
      return;
    }
    renderLoginForm();
  } catch (error) {
    console.error("Erro ao abrir portal de login:", error);
    const root = $("[data-login-root]");
    if (root) {
      root.innerHTML = `<article class="panel"><h2>Erro ao abrir o portal</h2><p class="muted">${escapeHtml(error?.message || "Falha inesperada ao renderizar.")}</p></article>`;
    }
  }
}

function renderLoginForm() {
  const root = $("[data-login-root]");
  root.innerHTML = `
    <form class="panel contact-form login-card" data-login-form>
      <h2>Entrar no portal</h2>
      <label>Usuário<input class="input" name="user" required autocomplete="username"></label>
      <label>Senha<input class="input" name="password" type="password" required autocomplete="current-password"></label>
      <button class="button primary" type="submit">Entrar</button>
    </form>
  `;
  $("[data-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const session = await findLogin(form.get("user"), form.get("password"));
    if (!session) {
      toast("Usuário ou senha inválidos.");
      return;
    }
    setSession(session);
    if (session.role === "teacher") {
      currentTeacherClass = "";
      currentTeacherSubject = "";
    }
    toast("Login realizado com sucesso.");
    renderLoginPortal();
  });
}

// ==================== PAINEL DO PROFESSOR ====================
function renderTeacherPanel(session) {
  const root = $("[data-login-root]");
  const teacher = state.teachers.find((item) => item.id === session.id);
  if (!teacher) {
    clearSession();
    renderLoginForm();
    return;
  }
  const teacherClasses = getTeacherClasses(teacher);
  const teacherSubjects = getTeacherSubjects(teacher);
  if (!teacherSubjects.length && teacher.subject) teacherSubjects.push(...parseTeacherSubjectList(teacher.subject));
  if (!teacherClasses.some((className) => normalizeLabel(className) === normalizeLabel(currentTeacherClass))) currentTeacherClass = "";
  const subjectsForSelectedClass = currentTeacherClass ? getValidSubjectsForTeacherClass(teacher, currentTeacherClass) : [];
  if (!subjectsForSelectedClass.some((subject) => normalizeLabel(subject) === normalizeLabel(currentTeacherSubject))) currentTeacherSubject = "";

  const activeSubject = currentTeacherSubject;
  const activeClass = currentTeacherClass;
  const teacherStudents = activeClass && activeSubject
    ? state.students.filter((student) => getClassLabel(student.className) === activeClass)
    : [];
  const teacherGrades = state.grades.filter(
    (grade) =>
      getSubjectLabel(grade.subject) === getSubjectLabel(activeSubject) &&
      getClassLabel(grade.className) === getClassLabel(activeClass)
  );

  root.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Professor: ${escapeHtml(teacher.name)}</h2>
        <p class="muted">Selecione uma turma e, depois, a disciplina desejada para lançar as notas.</p>
      </div>
      <div class="row-actions">
        <button class="button ghost" data-teacher-report>Relatório da disciplina</button>
        <a class="button ghost" href="https://portal.seduc.pi.gov.br/" target="_blank" rel="noopener">Abrir iSEDUC</a>
        <button class="button ghost" data-logout>Sair</button>
      </div>
    </div>
    <div class="panel">
      <div class="portal-heading compact">
        <div>
          <h2>Vínculo de trabalho</h2>
          <p class="muted">Use os botões para trocar a disciplina e a turma antes de lançar as notas.</p>
        </div>
      </div>
      <div class="segmented" role="tablist" aria-label="Turmas do professor">
        ${teacherClasses
          .map(
            (className) =>
              `<button type="button" class="${normalizeLabel(activeClass) === normalizeLabel(className) ? "active" : ""}" data-teacher-class="${escapeHtml(className)}">${escapeHtml(className)}</button>`
          )
          .join("") || `<span class="muted">Nenhuma turma vinculada.</span>`}
      </div>
      <div class="segmented" role="tablist" aria-label="Disciplinas da turma selecionada" style="margin-top:12px;">
        ${activeClass
          ? subjectsForSelectedClass
          .map(
            (subject) =>
              `<button type="button" class="${normalizeLabel(activeSubject) === normalizeLabel(subject) ? "active" : ""}" data-teacher-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>`
          )
          .join("") || `<span class="muted">Nenhuma disciplina vinculada a esta turma.</span>`
          : `<span class="muted">Escolha uma turma para ver as disciplinas.</span>`}
      </div>
    </div>
    <div class="panel">
      <div class="portal-heading compact">
        <div>
          <h2>Notas trimestrais</h2>
          <p class="muted">Disciplina atual: ${escapeHtml(activeSubject || "Não selecionada")}; turma atual: ${escapeHtml(activeClass || "não selecionada")}.</p>
        </div>
        <div class="segmented" role="tablist" aria-label="Trimestres">
          ${["1", "2", "3"].map((trimester) => `<button type="button" class="${currentTeacherTrimester === trimester ? "active" : ""}" data-teacher-trimester="${trimester}">${trimester}T</button>`).join("")}
        </div>
      </div>
      <form data-teacher-grade-form>
        <div class="gradebook-table">
          <div class="gradebook-head">
            <span>Estudante</span><span>N1</span><span>N2</span><span>N3</span><span>Média</span><span>Recuperação</span><span>Situação</span>
          </div>
          ${teacherStudents.map((student) => teacherStudentRow(student, teacher, currentTeacherTrimester, activeSubject, activeClass)).join("") || emptyState(activeClass ? "Escolha uma disciplina para lançar as notas." : "Escolha uma turma e depois uma disciplina.")}
        </div>
        <button class="button primary" type="submit" ${activeClass && activeSubject ? "" : "disabled"}>Salvar ${currentTeacherTrimester} trimestre</button>
      </form>
    </div>
    <div class="panel report-panel" data-teacher-report-panel hidden>
      <div class="portal-heading compact">
        <h2>Relatório geral da disciplina</h2>
        <button class="button ghost" data-pdf-report>Gerar PDF</button>
      </div>
      ${teacherReportTable(teacher, teacherGrades, activeSubject, activeClass)}
    </div>
  `;

  $("[data-logout]").addEventListener("click", () => {
    clearSession();
    renderLoginPortal();
  });

  $$("[data-teacher-trimester]").forEach((button) =>
    button.addEventListener("click", () => {
      currentTeacherTrimester = button.dataset.teacherTrimester;
      renderTeacherPanel(session);
    })
  );

  $$("[data-teacher-subject]").forEach((button) =>
    button.addEventListener("click", () => {
      currentTeacherSubject = button.dataset.teacherSubject;
      renderTeacherPanel(session);
    })
  );

  $$("[data-teacher-class]").forEach((button) =>
    button.addEventListener("click", () => {
      currentTeacherClass = button.dataset.teacherClass;
      currentTeacherSubject = "";
      renderTeacherPanel(session);
    })
  );

  $("[data-teacher-report]").addEventListener("click", () => {
    const panel = $("[data-teacher-report-panel]");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("[data-pdf-report]").addEventListener("click", () => {
    generatePdfReport(`Relatório — ${activeSubject} — ${activeClass}`, teacherReportTable(teacher, teacherGrades, activeSubject, activeClass));
  });

  setupTeacherGradeLivePreview(teacher, currentTeacherTrimester, activeSubject, activeClass);

  $("[data-teacher-grade-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeClass || !activeSubject) return toast("Escolha uma turma e uma disciplina antes de lançar as notas.");
    
    const gradeUpdates = [];
    for (const student of teacherStudents) {
      const existing = state.grades.find(
        (g) =>
          idsEqual(g.studentId, student.id) &&
          getSubjectLabel(g.subject) === getSubjectLabel(activeSubject) &&
          getClassLabel(g.className) === getClassLabel(activeClass)
      );

      const n1 = event.target.elements[`n1-${student.id}`]?.value || 0;
      const n2 = event.target.elements[`n2-${student.id}`]?.value || 0;
      const n3 = event.target.elements[`n3-${student.id}`]?.value || 0;
      const recoveryScore = event.target.elements[`rec-${student.id}`]?.value || 0;
      if (![n1, n2, n3, recoveryScore].every(isValidGradeScore)) {
        return toast(`A nota de ${student.name} deve estar entre 0 e 10.`);
      }
      const recovery = calculateTrimesterRecovery(n1, n2, n3);

      const gradeData = existing ? {
        ...existing,
        trimesters: {
          1: { ...normalizeTrimester(existing.trimesters?.[1]) },
          2: { ...normalizeTrimester(existing.trimesters?.[2]) },
          3: { ...normalizeTrimester(existing.trimesters?.[3]) }
        }
      } : {
        id: makeId(),
        studentId: student.id,
        subject: activeSubject,
        className: getClassLabel(activeClass),
        trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
      };

      gradeData.trimesters[currentTeacherTrimester] = { n1, n2, n3, recovery, recoveryScore };
      gradeUpdates.push({ existing, gradeData });
    }

    const submitButton = event.target.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Salvando...";
    }
    try {
      const savedGrades = await saveGradesToSupabase(gradeUpdates.map((item) => item.gradeData));
      gradeUpdates.forEach(({ existing, gradeData }) => {
        const savedGrade = savedGrades.find((item) => idsEqual(item.id, gradeData.id)) || gradeData;
        if (existing) {
          const index = state.grades.indexOf(existing);
          if (index >= 0) state.grades[index] = savedGrade;
        } else {
          state.grades.push(savedGrade);
        }
      });
      // Recarrega do banco para garantir que a tela mostre exatamente os dados
      // persistidos, inclusive depois de uma alteração em uma nota já lançada.
      await loadDataFromSupabase({ forceNetwork: true });
      toast(`${gradeUpdates.length} nota(s) salva(s) com sucesso.`);
      renderTeacherPanel(session);
    } catch (error) {
      console.error("Erro ao salvar notas:", error);
      toast("Não foi possível salvar as notas. Tente novamente.");
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = `Salvar ${currentTeacherTrimester} trimestre`;
      }
    }
  });
}

function teacherStudentRowV2(student, teacher, trimester) {
  const grade = state.grades.find(
    (g) => g.studentId === student.id && getSubjectLabel(g.subject) === getSubjectLabel(teacher.subject) && getClassLabel(g.className) === getClassLabel(student.className)
  ) || {
    trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
  };

  const trimesterData = getTrimester(grade, trimester);
  const average = getTrimesterAverage(trimesterData.n1, trimesterData.n2, trimesterData.n3);
  const hasCurrentTrimesterScores = [trimesterData.n1, trimesterData.n2, trimesterData.n3].some((value) => Number(value) > 0);
  const recoveryText =
    trimester === "3"
      ? hasCurrentTrimesterScores
        ? "Final"
        : "Pendente"
      : trimesterData.recovery
      ? "Recuperação"
      : "Sem recuperação";
  const statusText = trimester === "3" ? (hasCurrentTrimesterScores ? getTrimesterStatusText(grade, trimester) : "Pendente") : "Lançado";

  return `
    <div class="gradebook-row" data-grade-row data-student-id="${escapeHtml(student.id)}" data-trimester="${trimester}">
      <div>
        <strong>${escapeHtml(student.name)}</strong>
        <small>Turma ${escapeHtml(getClassLabel(student.className))}</small>
      </div>
      <input class="input" name="n1-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n1 || ""}" data-score-input="n1">
      <input class="input" name="n2-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n2 || ""}" data-score-input="n2">
      <input class="input" name="n3-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n3 || ""}" data-score-input="n3">
      <strong data-average>${average}</strong>
      <span class="badge" data-recovery>${recoveryText}</span>
      <span class="badge" data-status>${statusText}</span>
    </div>
  `;
}

function setupTeacherGradeLivePreviewV2(teacher, trimester) {
  $$("[data-grade-row]").forEach((row) => {
    const studentId = row.dataset.studentId;
    const student = state.students.find((item) => item.id === studentId);
    if (!student) return;

    const baseGrade = state.grades.find(
      (g) => g.studentId === student.id && getSubjectLabel(g.subject) === getSubjectLabel(teacher.subject) && getClassLabel(g.className) === getClassLabel(student.className)
    ) || {
      studentId: student.id,
      subject: teacher.subject,
      className: getClassLabel(student.className),
      trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
    };

    const updateRow = () => {
      const n1 = row.querySelector('[data-score-input="n1"]')?.value || 0;
      const n2 = row.querySelector('[data-score-input="n2"]')?.value || 0;
      const n3 = row.querySelector('[data-score-input="n3"]')?.value || 0;
      const snapshot = getGradeSnapshot(baseGrade, trimester, { n1, n2, n3 });
      const currentTrimester = getTrimester(snapshot, trimester);
      const average = getTrimesterAverage(currentTrimester.n1, currentTrimester.n2, currentTrimester.n3);
      const recovery = trimester === "3" ? "Final" : currentTrimester.recovery ? "Recuperação" : "Sem recuperação";
      const status = trimester === "3" ? getTrimesterStatusText(snapshot, "3") : "Lançado";

      const averageEl = row.querySelector("[data-average]");
      const recoveryEl = row.querySelector("[data-recovery]");
      const statusEl = row.querySelector("[data-status]");

      if (averageEl) averageEl.textContent = average;
      if (recoveryEl) recoveryEl.textContent = hasTrimesterScores(snapshot, trimester) ? recovery : "Pendente";
      if (statusEl) statusEl.textContent = status;
    };

    row.querySelectorAll("[data-score-input]").forEach((input) => {
      input.addEventListener("input", updateRow);
    });

    updateRow();
  });
}

function teacherReportTableV2(teacher, grades) {
  const rows = grades
    .map((grade) => {
      const student = state.students.find((item) => item.id === grade.studentId);
      const t1Recovery = getTrimester(grade, "1").recovery;
      const t2Recovery = getTrimester(grade, "2").recovery;
      const t3Recovery = getTrimester(grade, "3").recovery;
      return `
        <tr>
          <td>${escapeHtml(student?.name || "Aluno")}</td>
          <td>${escapeHtml(getClassLabel(grade.className))}</td>
          <td>${trimesterAverage(grade, "1")} ${t1Recovery ? "(Rec)" : ""}</td>
          <td>${trimesterAverage(grade, "2")} ${t2Recovery ? "(Rec)" : ""}</td>
          <td>${trimesterAverage(grade, "3")} ${t3Recovery ? "(Rec)" : ""}</td>
          <td>${gradeAverage(grade)}</td>
          <td>${t1Recovery || t2Recovery || t3Recovery ? "Em recuperação" : Number(gradeAverage(grade)) >= 6 ? "Aprovado" : "Recuperação final"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="report-table">
        <thead>
          <tr><th>Aluno</th><th>Turma</th><th>1T</th><th>2T</th><th>3T</th><th>Final</th><th>Situação</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">Nenhuma nota registrada em ${escapeHtml(getSubjectLabel(teacher.subject))}.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

// ==================== PAINEL DO ALUNO ====================
function getTeachersForSubjectAndClass(subject, className) {
  const subjectLabel = getSubjectLabel(subject);
  const classLabel = getClassLabel(className);
  return state.teachers.filter((teacher) =>
    getTeacherSubjectClassPairs(teacher).some(
      (pair) => getSubjectLabel(pair.subject) === subjectLabel && getClassLabel(pair.className) === classLabel
    )
  );
}

function getStudentSubjectEntries(student) {
  const className = getClassLabel(student.className);
  const subjects = new Set(getSubjectsForClass(className));
  state.grades
    .filter((grade) => idsEqual(grade.studentId, student.id))
    .forEach((grade) => subjects.add(getSubjectLabel(grade.subject)));

  return [...subjects]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .map((subject) => ({
      subject,
      grade: state.grades.find(
        (grade) => idsEqual(grade.studentId, student.id) && getSubjectLabel(grade.subject) === subject
      ) || null,
      teachers: getTeachersForSubjectAndClass(subject, className)
    }));
}

function renderStudentPanel(session) {
  const root = $("[data-login-root]");
  const student = state.students.find((item) => item.id === session.id);
  if (!student) {
    clearSession();
    renderLoginForm();
    return;
  }

  if (student.isJournalist && currentStudentView === "newsroom") {
    renderStudentNewsroom(session, student);
    return;
  }

  const studentClassInfo = getStudentClassInfo(student);
  const subjectEntries = getStudentSubjectEntries(student);
  const grades = subjectEntries.map((entry) => entry.grade).filter(Boolean);
  const allGradesComplete = subjectEntries.length > 0 && subjectEntries.every(
    (entry) => entry.grade && ["1", "2", "3"].every((trimester) => getTrimesterFinalAverage(entry.grade, trimester) !== "0.0")
  );
  const averages = grades.map((grade) => Number(gradeAverage(grade)));
  const generalAverage = averages.filter((a) => a > 0).length
    ? (averages.filter((a) => a > 0).reduce((total, value) => total + value, 0) / averages.filter((a) => a > 0).length).toFixed(1)
    : "0.0";

  const hasRecoveryTrimester = grades.some(
    (grade) =>
      getTrimester(grade, "1").recovery ||
      getTrimester(grade, "2").recovery ||
      getTrimester(grade, "3").recovery
  );

  const finalRecovery = allGradesComplete && Number(generalAverage) < 6;

  root.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Boletim de ${escapeHtml(student.name)}</h2>
        <p class="muted">Turma: ${escapeHtml(studentClassInfo.classLabel || getClassLabel(student.className))}</p>
      </div>
      <div class="row-actions">
        ${student.isJournalist ? '<button class="button primary" type="button" data-student-newsroom>Jornal escolar</button>' : ""}
        <button class="button ghost" data-student-report>Ver boletim</button>
        <button class="button ghost" data-logout>Sair</button>
      </div>
    </div>
    <div class="panel">
      <h3>Vínculos da turma</h3>
      <p class="muted">Professor(es): ${studentClassInfo.teachers.map((teacher) => escapeHtml(teacher.name)).join(", ") || "Não vinculado"}</p>
      <p class="muted">Disciplina(s): ${studentClassInfo.subjects.map(escapeHtml).join(", ") || "Não vinculada"}</p>
    </div>
    <div class="dashboard-grid">
      ${miniStat("Média geral", generalAverage)}
      ${miniStat("Disciplinas", subjectEntries.length)}
      ${miniStat("Situação", allGradesComplete ? (finalRecovery ? "Recuperação final" : "Aprovado") : "Pendente")}
    </div>
    <article class="panel recovery-panel ${hasRecoveryTrimester || finalRecovery ? "warning" : ""}">
      <strong>${
        hasRecoveryTrimester && !finalRecovery
          ? "Aluno em recuperação em algum trimestre. Procure a escola para acompanhar o plano de estudos."
          : finalRecovery
          ? "Aluno em recuperação final. Procure a escola para agendar a avaliação."
          : allGradesComplete
          ? "Aluno aprovado!"
          : "Aguardando preenchimento de todas as notas..."
      }</strong>
    </article>
    <div class="panel">
      <h3>Notas por disciplina</h3>
      <div class="toolbar">
        <label class="sr-only" for="student-subject-filter">Selecionar disciplina</label>
        <select class="input" id="student-subject-filter" data-student-subject-filter>
          <option value="">Selecione uma disciplina</option>
          ${subjectEntries.map((entry) => `<option value="${escapeHtml(normalizeLabel(entry.subject))}">${escapeHtml(entry.subject)}</option>`).join("")}
        </select>
      </div>
      <p class="muted" data-student-subject-filter-message>Selecione uma disciplina para consultar as notas.</p>
      <div class="grade-grid" data-student-subject-grades>
        ${subjectEntries.map((entry) => `<div data-student-subject-card data-subject="${escapeHtml(normalizeLabel(entry.subject))}" hidden>${studentGradeCard(entry.grade, entry.subject, entry.teachers)}</div>`).join("") || emptyState("Nenhuma disciplina vinculada à turma.")}
      </div>
    </div>
    <div class="panel report-panel" data-student-report-panel hidden>
      <div class="portal-heading compact">
        <h2>Boletim escolar</h2>
        <button class="button ghost" data-pdf-report>Gerar PDF</button>
      </div>
      ${studentReportTable(subjectEntries, allGradesComplete, finalRecovery)}
    </div>
  `;

  $("[data-logout]").addEventListener("click", () => {
    clearSession();
    renderLoginPortal();
  });

  const newsroomButton = $("[data-student-newsroom]");
  if (newsroomButton) newsroomButton.addEventListener("click", () => {
    currentStudentView = "newsroom";
    renderStudentPanel(session);
  });

  const subjectFilter = $("[data-student-subject-filter]");
  const subjectFilterMessage = $("[data-student-subject-filter-message]");
  subjectFilter?.addEventListener("change", () => {
    const selectedSubject = normalizeLabel(subjectFilter.value);
    $$('[data-student-subject-card]').forEach((card) => {
      card.hidden = !selectedSubject || card.dataset.subject !== selectedSubject;
    });
    if (subjectFilterMessage) {
      subjectFilterMessage.textContent = selectedSubject
        ? "Notas da disciplina selecionada."
        : "Selecione uma disciplina para consultar as notas.";
    }
  });

  $("[data-student-report]").addEventListener("click", () => {
    const panel = $("[data-student-report-panel]");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("[data-pdf-report]").addEventListener("click", () => {
    generatePdfReport(`Boletim — ${student.name}`, studentReportTable(subjectEntries, allGradesComplete, finalRecovery));
  });
}

function renderStudentNewsroom(session, student) {
  const root = $("[data-login-root]");
  const ownNews = state.news.filter((item) => idsEqual(item.created_by_student_id, student.id));
  const editing = adminEditState.contentId ? ownNews.find((item) => idsEqual(item.id, adminEditState.contentId)) : null;
  const item = editing || { category: "Jornal escolar", date: new Date().toISOString().slice(0, 10), files: [] };
  let selectedFiles = Array.isArray(item.files) ? [...item.files] : [];

  root.innerHTML = `
    <div class="portal-heading">
      <div><span class="badge">Aluno jornalista</span><h2>Redação do jornal escolar</h2><p class="muted">Crie a matéria e envie para o administrador publicar.</p></div>
      <div class="row-actions"><button class="button ghost" type="button" data-student-bulletin>Meu boletim</button><button class="button ghost" type="button" data-logout>Sair</button></div>
    </div>
    <form class="panel contact-form" data-journalist-form>
      <input type="hidden" name="id" value="${escapeHtml(item.id || "")}">
      <label>Título da matéria<input class="input" name="title" value="${escapeHtml(item.title || "")}" required></label>
      <label>Resumo<textarea class="input" name="summary" rows="3">${escapeHtml(item.summary || "")}</textarea></label>
      <label>Conteúdo<textarea class="input" name="content" rows="8" required>${escapeHtml(item.content || "")}</textarea></label>
      <label>Categoria<input class="input" name="category" value="${escapeHtml(item.category || "Jornal escolar")}"></label>
      <label>Data<input class="input" name="date" type="date" value="${escapeHtml(item.date || "")}"></label>
      <fieldset class="upload-zone"><legend>Imagens e arquivos</legend><input class="input" data-journalist-files type="file" accept="image/*,video/*,.pdf,.doc,.docx,.txt" multiple><small class="muted">Até 10 MB por arquivo e 25 MB no total.</small><div class="attachment-list" data-journalist-attachments></div></fieldset>
      <div class="row-actions"><button class="button primary" type="submit">${editing ? "Atualizar matéria" : "Enviar para revisão"}</button>${editing ? '<button class="button ghost" type="button" data-journalist-cancel>Cancelar edição</button>' : ""}</div>
    </form>
    <div class="panel"><h3>Minhas matérias</h3><div class="list-view">
      ${ownNews.map((news) => `<article class="list-item"><div><strong>${escapeHtml(news.title)}</strong><p class="muted">${news.published ? "Publicada" : "Aguardando publicação"}.</p></div><button class="button ghost" type="button" data-journalist-edit data-id="${escapeHtml(news.id)}">Editar</button></article>`).join("") || emptyState("Você ainda não enviou nenhuma matéria.")}
    </div></div>`;

  const attachmentList = $("[data-journalist-attachments]");
  const refreshAttachments = () => {
    attachmentList.innerHTML = attachmentEditor(selectedFiles);
    $$("[data-remove-attachment]", attachmentList).forEach((button) => button.addEventListener("click", () => {
      selectedFiles.splice(Number(button.dataset.removeAttachment), 1);
      refreshAttachments();
    }));
  };
  refreshAttachments();

  $("[data-journalist-files]").addEventListener("change", async (event) => {
    try {
      selectedFiles = await readAttachments(event.target.files, selectedFiles);
      event.target.value = "";
      refreshAttachments();
    } catch (error) {
      toast(error.message || "Erro ao carregar o arquivo.");
    }
  });

  $("[data-journalist-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const payload = {
      ...(id ? { id } : {}),
      title: String(form.get("title") || "").trim(), summary: String(form.get("summary") || "").trim(),
      content: String(form.get("content") || "").trim(), category: String(form.get("category") || "Jornal escolar").trim(),
      author: student.name, date: String(form.get("date") || "").trim(), published: false,
      files: selectedFiles, created_by_student_id: student.id
    };
    if (!payload.title || !payload.content) return toast("Informe o título e o conteúdo da matéria.");
    const saved = await upsertRecord("news", payload, "id", id ? "Matéria atualizada e enviada para revisão." : "Matéria enviada para revisão.");
    if (saved) { adminEditState.contentId = null; renderStudentNewsroom(session, student); }
  });

  $$("[data-journalist-edit]").forEach((button) => button.addEventListener("click", () => { adminEditState.contentId = button.dataset.id; renderStudentNewsroom(session, student); }));
  const cancel = $("[data-journalist-cancel]");
  if (cancel) cancel.addEventListener("click", () => { adminEditState.contentId = null; renderStudentNewsroom(session, student); });
  $("[data-student-bulletin]").addEventListener("click", () => { currentStudentView = "bulletin"; adminEditState.contentId = null; renderStudentPanel(session); });
  $("[data-logout]").addEventListener("click", () => { currentStudentView = "bulletin"; clearSession(); renderLoginPortal(); });
}

function studentGradeCard(grade, subject, teachers = []) {
  const hasGrade = Boolean(grade);
  const gradeData = grade || { trimesters: {} };
  const average = gradeAverage(gradeData);
  const t1Recovery = getTrimester(gradeData, "1").recovery;
  const t2Recovery = getTrimester(gradeData, "2").recovery;
  const t3Recovery = getTrimester(gradeData, "3").recovery;
  const approved = Number(average) >= 6;
  const teacherNames = teachers.map((teacher) => teacher.name).filter(Boolean).join(", ");

  return `
    <article class="panel grade-card">
      <div class="grade-card-head">
        <div>
          <span class="badge">${escapeHtml(subject || getSubjectLabel(gradeData.subject))}</span>
          <p class="muted">Professor(a): ${escapeHtml(teacherNames || "Não vinculado")}</p>
          <h3>Média final ${average}</h3>
        </div>
        <strong class="badge ${hasGrade && approved ? "success" : "warning"}">${hasGrade ? (approved ? "Aprovado" : "Em andamento") : "Aguardando notas"}</strong>
      </div>
      <div class="grade-chart" aria-label="Grafico de notas">
        ${gradeBar("1T", trimesterAverage(gradeData, "1"), t1Recovery)}
        ${gradeBar("2T", trimesterAverage(gradeData, "2"), t2Recovery)}
        ${gradeBar("3T", trimesterAverage(gradeData, "3"), t3Recovery)}
        ${gradeBar("Média", average, false)}
      </div>
      <div class="trimester-grid">
        ${["1", "2", "3"].map((trimester) => trimesterMiniTable(gradeData, trimester)).join("")}
      </div>
    </article>
  `;
}

function trimesterMiniTableV2(grade, trimester) {
  const data = getTrimester(grade, trimester);
  const recoveryStatus = data.recovery ? " - EM RECUPERACAO" : "";
  return `
    <div class="trimester-mini">
      <strong>${trimester} trimestre${recoveryStatus}</strong>
      <span>N1 ${Number(data.n1).toFixed(1)}</span>
      <span>N2 ${Number(data.n2).toFixed(1)}</span>
      <span>N3 ${Number(data.n3).toFixed(1)}</span>
      <span>Média ${getTrimesterAverage(data.n1, data.n2, data.n3)}</span>
    </div>
  `;
}

function studentReportTable(subjectEntries, allComplete, finalRecovery) {
  const rows = subjectEntries
    .map(({ subject, grade, teachers }) => {
      const gradeData = grade || { trimesters: {} };
      const t1Recovery = getTrimester(gradeData, "1").recovery;
      const t2Recovery = getTrimester(gradeData, "2").recovery;
      const t3Recovery = getTrimester(gradeData, "3").recovery;
      const approved = Number(gradeAverage(gradeData)) >= 6;
      const teacherNames = teachers.map((teacher) => teacher.name).filter(Boolean).join(", ");
      return `
        <tr>
          <td>${escapeHtml(subject)}</td>
          <td>${escapeHtml(teacherNames || "Não vinculado")}</td>
          <td>${trimesterAverage(gradeData, "1")} ${t1Recovery ? "(Rec)" : ""}</td>
          <td>${trimesterAverage(gradeData, "2")} ${t2Recovery ? "(Rec)" : ""}</td>
          <td>${trimesterAverage(gradeData, "3")} ${t3Recovery ? "(Rec)" : ""}</td>
          <td>${gradeAverage(gradeData)}</td>
          <td>${grade ? (allComplete ? (approved ? "Aprovado" : finalRecovery ? "Recuperação final" : "Recuperação") : "Pendente") : "Sem notas"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="report-table">
        <thead>
          <tr><th>Disciplina</th><th>Professor(a)</th><th>1T</th><th>2T</th><th>3T</th><th>Final</th><th>Situação</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">Nenhuma disciplina vinculada à turma.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function gradeBar(label, value, isRecovery = false) {
  const percent = Math.max(0, Math.min(100, Number(value) * 10));
  const recoveryText = isRecovery ? " - REC" : "";
  return `
    <div class="grade-bar">
      <span>${label}${recoveryText}</span>
      <div><i style="width:${percent}%"></i></div>
      <strong>${Number(value).toFixed(1)}</strong>
    </div>
  `;
}

function miniStat(label, value) {
  return `<div class="mini-stat"><strong>${value}</strong><span>${label}</span></div>`;
}

function generatePdfReport(title, content) {
  const reportWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!reportWindow) {
    toast("Permita pop-ups para gerar o PDF.");
    return;
  }
  const generatedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  reportWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
          .pdf-header {
            display: grid;
            grid-template-columns: 82px 1fr;
            gap: 16px;
            align-items: center;
            border-bottom: 3px solid #253a9b;
            margin-bottom: 18px;
            padding-bottom: 14px;
          }
          .pdf-logo {
            width: 78px;
            height: 78px;
            object-fit: contain;
          }
          .school-name {
            font-size: 19px;
            font-weight: 800;
            text-transform: uppercase;
            color: #253a9b;
            margin: 0 0 4px;
          }
          .school-info {
            display: grid;
            gap: 2px;
            color: #4b5563;
            font-size: 12px;
            margin: 0;
          }
          h1 { font-size: 21px; margin: 0 0 14px; }
          p { margin: 0; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
          th { background: #253a9b; color: white; }
          .table-scroll { overflow: visible; }
          .report-meta { margin-bottom: 12px; font-size: 12px; }
          .actions { display: flex; gap: 8px; margin-top: 18px; }
          button { border: 1px solid #253a9b; background: #253a9b; color: white; padding: 10px 14px; font-weight: 700; cursor: pointer; }
          @media print { .actions { display: none; } }
        </style>
      </head>
      <body>
        <header class="pdf-header">
          <img class="pdf-logo" src="${SCHOOL_LOGO}" alt="Logo do CETI Maria Neusa de Sousa">
          <div>
            <p class="school-name">CETI Maria Neusa de Sousa</p>
            <p class="school-info">
              <span>Centro Estadual de Tempo Integral</span>
              <span>${escapeHtml(state.contact.address)}</span>
              <span>Telefone: ${escapeHtml(state.contact.phone)} | E-mail: ${escapeHtml(state.contact.email)}</span>
            </p>
          </div>
        </header>
        <h1>${escapeHtml(title)}</h1>
        <p class="report-meta">Documento gerado em ${generatedAt}</p>
        ${content}
        <div class="actions">
          <button onclick="window.print()">Salvar como PDF</button>
          <button onclick="window.close()">Fechar</button>
        </div>
        <script>
          window.addEventListener("load", () => {
            const logo = document.querySelector(".pdf-logo");
            const printReport = () => setTimeout(() => window.print(), 300);
            if (logo && !logo.complete) {
              logo.addEventListener("load", printReport, { once: true });
              logo.addEventListener("error", printReport, { once: true });
              return;
            }
            printReport();
          });
        <\/script>
      </body>
    </html>
  `);
  reportWindow.document.close();
}

// ==================== ADMIN PAINEL ====================
const ADMIN_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

async function syncAdminData(message) {
  await loadDataFromSupabase();
  renderPublic();
  if ((location.hash || "").replace("#", "").split("?")[0] === "login") {
    renderLoginPortal();
  }
  if (message) toast(message);
}

function tabLabel(tab) {
  return {
    dashboard: "Dashboard",
    school: "Escola",
    catalog: "Catálogo",
    students: "Alunos",
    teachers: "Professores",
    grades: "Notas",
    content: "Conteúdo",
    news: "Notícias",
    events: "Eventos",
    activities: "Atividades",
    achievements: "Conquistas"
  }[tab];
}

function renderAdmin() {
  const root = $("[data-login-root]");
  const session = getSession();
  if (!session || session.role !== "admin") {
    renderLoginForm();
    return;
  }

  root.innerHTML = `
    <div class="admin-layout">
      <aside class="admin-tabs" aria-label="Menu administrativo">
        ${["dashboard", "school", "catalog", "students", "teachers", "grades", "content"]
          .map((tab) => `<button data-admin-tab="${tab}" class="${currentAdminTab === tab ? "active" : ""}">${tabLabel(tab)}</button>`)
          .join("")}
        <button data-logout>Sair</button>
      </aside>
      <section class="panel" data-admin-content></section>
    </div>
  `;

  $$("[data-admin-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      currentAdminTab = button.dataset.adminTab;
      renderAdminContent();
    })
  );

  $("[data-logout]").addEventListener("click", () => {
    clearSession();
    renderLoginPortal();
  });

  renderAdminContent();
}

function renderAdminContent() {
  const content = $("[data-admin-content]");
  if (!content) return;

  if (currentAdminTab === "dashboard") {
    content.innerHTML = `
      <h2>Dashboard</h2>
      <div class="dashboard-grid">
        ${miniStat("Notícias", state.news.length)}
        ${miniStat("Turmas", state.classes.length)}
        ${miniStat("Alunos", state.students.length)}
        ${miniStat("Professores", state.teachers.length)}
        ${miniStat("Notas", state.grades.length)}
        ${miniStat("Eventos", state.events.length)}
        ${miniStat("Atividades", state.activities.length)}
        ${miniStat("Conquistas", state.achievements.length)}
      </div>
    `;
    return;
  }

  if (currentAdminTab === "school") {
    renderSchoolAdmin(content);
    return;
  }

  if (currentAdminTab === "catalog") {
    renderCatalogAdmin(content);
    return;
  }

  if (currentAdminTab === "students") {
    renderStudentsAdmin(content);
    return;
  }

  if (currentAdminTab === "teachers") {
    renderTeachersAdmin(content);
    return;
  }

  if (currentAdminTab === "grades") {
    renderGradesAdmin(content);
    return;
  }

  if (currentAdminTab === "content") {
    renderContentAdmin(content);
  }
}

function buildOptions(items, selected = "") {
  return items
    .map((item) => {
      const value = typeof item === "string" ? item : item.value;
      const label = typeof item === "string" ? item : item.label;
      return `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function parseCommaList(value) {
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function currentSchoolConfig() {
  return {
    id: ADMIN_CONFIG_ID,
    history: state.about.history || "",
    mission: state.about.mission || "",
    vision: state.about.vision || "",
    values: state.about.values || "",
    address: state.contact.address || "",
    phone: state.contact.phone || "",
    email: state.contact.email || "",
    team: state.team || []
  };
}

async function upsertRecord(table, payload, conflict = "id", successMessage = "Registro salvo com sucesso.") {
  try {
    console.log("Tabela:", table);
    console.log("Payload:", payload);

    const { data: savedData, error } = await supabase
      .from(table)
      .upsert([payload], { onConflict: conflict })
      .select();

    if (error) throw error;
    if (!savedData?.length) throw new Error(`O banco não confirmou o salvamento em ${table}.`);
    console.log("Data:", savedData);

    clearCache(table);
    await syncAdminData(successMessage);
    return true;

  } catch (error) {
    console.error("Erro completo:", error);
    const databaseNeedsUpdate = error?.code === "PGRST204" || error?.code === "42501";
    const missingColumn = error?.message?.match(/(?:Could not find the '([^']+)' column|column [^.]+\.([^ ]+) does not exist)/)?.slice(1).find(Boolean);
    toast(
      databaseNeedsUpdate
        ? missingColumn
          ? `Falta a coluna “${missingColumn}” no banco. Execute novamente supabase-add-attachments.sql no Supabase.`
          : "Banco desatualizado ou sem permissão. Execute novamente supabase-add-attachments.sql no Supabase."
        : error?.message
        ? `Erro ao salvar: ${error.message}`
        : `Erro ao salvar ${table}.`
    );
    return false;
  }
}
async function deleteRecord(table, column, value, successMessage = "Registro removido com sucesso.") {
  try {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) throw error;
    clearCache(table);
    await syncAdminData(successMessage);
  } catch (error) {
    console.error(`Erro ao remover ${table}:`, error);
    toast(`Erro ao remover ${table}.`);
  }
}

function renderSchoolAdmin(content) {
  const config = currentSchoolConfig();
  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Configuração da escola</h2>
        <p class="muted">Edite historia, missao, visao, valores, contato e equipe institucional.</p>
      </div>
    </div>
    <form class="panel contact-form" data-school-form>
      <label>Historia<textarea class="input" name="history" rows="4">${escapeHtml(config.history)}</textarea></label>
      <label>Missao<textarea class="input" name="mission" rows="3">${escapeHtml(config.mission)}</textarea></label>
      <label>Visao<textarea class="input" name="vision" rows="3">${escapeHtml(config.vision)}</textarea></label>
      <label>Valores<textarea class="input" name="values" rows="3">${escapeHtml(config.values)}</textarea></label>
      <label>Endereco<input class="input" name="address" value="${escapeHtml(config.address)}"></label>
      <label>Telefone<input class="input" name="phone" value="${escapeHtml(config.phone)}"></label>
      <label>E-mail<input class="input" name="email" type="email" value="${escapeHtml(config.email)}"></label>
      <label>Equipe institucional<textarea class="input" name="team" rows="5" placeholder="Nome | Cargo">${escapeHtml(
        (config.team || []).map((person) => `${person.name} | ${person.role}`).join("\n")
      )}</textarea></label>
      <button class="button primary" type="submit">Salvar configuracao</button>
    </form>
  `;

  $("[data-school-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const team = parseCommaList(form.get("team"))
      .map((line) => line.split("|").map((part) => part.trim()))
      .filter((parts) => parts[0])
      .map(([name, role]) => ({ name, role: role || "Equipe" }));

    await upsertRecord(
      "school_config",
      {
        id: ADMIN_CONFIG_ID,
        history: form.get("history"),
        mission: form.get("mission"),
        vision: form.get("vision"),
        values: form.get("values"),
        address: form.get("address"),
        phone: form.get("phone"),
        email: form.get("email"),
        team
      },
      "id",
      "Configuração da escola salva."
    );
  });
}

function renderCatalogAdmin(content) {
  const classRows = state.classes
    .map((classItem) => {
      return `<div class="list-item">
        <form class="row-actions" data-class-row data-current="${escapeHtml(classItem.name)}">
          <input class="input" name="name" value="${escapeHtml(classItem.name)}">
          <button class="button ghost" type="submit">Salvar</button>
          <button class="button ghost" type="button" data-class-delete data-name="${escapeHtml(classItem.name)}">Excluir</button>
        </form>
      </div>`;
    })
    .join("");

  const subjectRows = state.subjects
    .slice()
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"))
    .map((subjectItem) => {
      return `<div class="list-item" data-subject-row-item data-subject-name="${escapeHtml(normalizeLabel(subjectItem.name))}">
        <form class="row-actions" data-subject-row data-current="${escapeHtml(subjectItem.name)}">
          <input class="input" name="name" value="${escapeHtml(subjectItem.name)}">
          <button class="button ghost" type="submit">Salvar</button>
          <button class="button ghost" type="button" data-subject-delete data-name="${escapeHtml(subjectItem.name)}">Excluir</button>
        </form>
      </div>`;
    })
    .join("");

  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Catálogo geral</h2>
        <p class="muted">Gerencie turmas e disciplinas usadas em alunos, professores e notas.</p>
      </div>
    </div>
    <div class="split-layout">
      <article class="panel">
        <h3>Turmas</h3>
        <form class="row-actions" data-class-add>
          <input class="input" name="name" placeholder="Nova turma">
          <button class="button primary" type="submit">Adicionar</button>
        </form>
        <div class="list-view scrollable-list catalog-list">${classRows || emptyState("Nenhuma turma cadastrada.")}</div>
      </article>
      <article class="panel">
        <h3>Disciplinas</h3>
        <form class="row-actions" data-subject-add>
          <input class="input" name="name" placeholder="Nova disciplina">
          <button class="button primary" type="submit">Adicionar</button>
        </form>
        <input class="input catalog-search" type="search" data-subject-search placeholder="Pesquisar disciplina" aria-label="Pesquisar disciplinas">
        <p class="muted" data-subject-filter-status>${state.subjects.length} disciplina(s) encontrada(s).</p>
        <div class="list-view scrollable-list catalog-list">${subjectRows || emptyState("Nenhuma disciplina cadastrada.")}</div>
      </article>
    </div>
  `;

  $("[data-class-add]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get("name") || "").trim();
    if (!name) return toast("Informe o nome da turma.");
    await upsertRecord("classes", { name }, "name", "Turma salva.");
  });

  $$("[data-class-row]").forEach((row) =>
    row.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const current = event.currentTarget.dataset.current;
        const form = new FormData(event.currentTarget);
        const name = String(form.get("name") || "").trim();
        if (!name) return toast("Informe o nome da turma.");
        const { error } = await supabase.from("classes").update({ name }).eq("name", current);
        if (error) throw error;
        clearCache("classes");
        await syncAdminData("Turma atualizada.");
      } catch (error) {
        console.error("Erro ao atualizar turma:", error);
        toast("Erro ao atualizar turma.");
      }
    })
  );

  $$("[data-class-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord("classes", "name", button.dataset.name, "Turma removida.");
    })
  );

  $("[data-subject-add]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get("name") || "").trim();
    if (!name) return toast("Informe o nome da disciplina.");
    await upsertRecord("subjects", { name }, "name", "Disciplina salva.");
  });

  $$("[data-subject-row]").forEach((row) =>
    row.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const current = event.currentTarget.dataset.current;
        const form = new FormData(event.currentTarget);
        const name = String(form.get("name") || "").trim();
        if (!name) return toast("Informe o nome da disciplina.");
        const { error } = await supabase.from("subjects").update({ name }).eq("name", current);
        if (error) throw error;
        clearCache("subjects");
        await syncAdminData("Disciplina atualizada.");
      } catch (error) {
        console.error("Erro ao atualizar disciplina:", error);
        toast("Erro ao atualizar disciplina.");
      }
    })
  );

  $$("[data-subject-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord("subjects", "name", button.dataset.name, "Disciplina removida.");
    })
  );

  const subjectSearch = $("[data-subject-search]");
  const subjectFilterStatus = $("[data-subject-filter-status]");
  subjectSearch?.addEventListener("input", () => {
    const term = normalizeLabel(subjectSearch.value);
    let visible = 0;
    $$('[data-subject-row-item]').forEach((row) => {
      const matches = !term || row.dataset.subjectName.includes(term);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    if (subjectFilterStatus) subjectFilterStatus.textContent = `${visible} disciplina(s) encontrada(s).`;
  });
}

function renderStudentPasswordChange(session) {
  const root = $("[data-login-root]");
  root.innerHTML = `
    <form class="panel contact-form login-card" data-student-password-form>
      <h2>Crie sua nova senha</h2>
      <p class="muted">Por segurança, a senha padrão deve ser alterada antes de acessar o portal.</p>
      <label>Nova senha<input class="input" name="password" type="password" minlength="4" required autocomplete="new-password"></label>
      <label>Confirmar nova senha<input class="input" name="confirmation" type="password" minlength="4" required autocomplete="new-password"></label>
      <button class="button primary" type="submit">Salvar nova senha</button>
      <button class="button ghost" type="button" data-logout>Sair</button>
    </form>
  `;
  $("[data-student-password-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const password = normalizePassword(form.get("password"));
    if (password !== normalizePassword(form.get("confirmation"))) return toast("As senhas não conferem.");
    if (password === DEFAULT_STUDENT_PASSWORD) return toast("Escolha uma senha diferente da senha padrão.");
    const { error } = await supabase
      .from("students")
      .update({ password, must_change_password: false })
      .eq("id", session.id);
    if (error) {
      console.error("Erro ao alterar senha do aluno:", error);
      return toast("Não foi possível alterar a senha. Tente novamente.");
    }
    clearCache("students");
    setSession({ ...session, mustChangePassword: false });
    await loadDataFromSupabase();
    toast("Senha alterada com sucesso.");
    renderLoginPortal();
  });
  $("[data-logout]").addEventListener("click", () => {
    clearSession();
    renderLoginForm();
  });
}

function renderStudentsAdmin(content) {
  const editing = adminEditState.studentId ? state.students.find((item) => idsEqual(item.id, adminEditState.studentId)) : null;
  const selectedClassName = getClassLabel(editing?.className || "");
  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Alunos</h2>
        <p class="muted">Crie, edite e remova alunos sincronizados com o Supabase.</p>
      </div>
    </div>
    <div class="panel">
      <h3>Cadastro em massa</h3>
      <p class="muted">Envie um arquivo CSV com as colunas <strong>name</strong> e <strong>className</strong>. O usuário será criado automaticamente a partir do nome e a senha padrão será <strong>1234</strong>.</p>
      <label>Arquivo CSV<input class="input" type="file" accept=".csv" data-student-bulk-file></label>
      <button class="button primary" type="button" data-student-bulk-import>Importar alunos em massa</button>
      <div class="panel" style="margin-top: 0.5rem;" data-student-bulk-preview><p class="muted">Nenhum arquivo selecionado.</p></div>
    </div>
    <form class="panel contact-form" data-student-form>
      <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}">
      <label>Nome<input class="input" name="name" value="${escapeHtml(editing?.name || "")}" required></label>
      <label>Turma
        <select class="input" name="className" required data-student-class-select>
          <option value="">Selecione</option>
          ${buildOptions(state.classes.map((item) => ({ value: item.name, label: item.name })), getClassLabel(editing?.className || ""))}
        </select>
      </label>
      <div class="panel" style="margin-top: 0.5rem;" data-student-class-info>
        ${renderClassLinkInfo(selectedClassName)}
      </div>
      <label>Usuário<input class="input" name="user" value="${escapeHtml(editing?.user || "")}" readonly></label>
      <p class="muted">O usuário é criado automaticamente usando o primeiro nome. Se já existir, o sistema acrescenta um número. A senha inicial é <strong>1234</strong> e deve ser alterada no primeiro acesso.</p>
      <label class="checkbox-row"><input type="checkbox" name="isJournalist"${editing?.isJournalist ? " checked" : ""}> Aluno jornalista — pode criar matérias para o jornal escolar</label>
      <div class="row-actions">
        <button class="button primary" type="submit">${editing ? "Atualizar aluno" : "Salvar aluno"}</button>
        ${editing ? '<button class="button ghost" type="button" data-student-cancel>Cancelar edição</button>' : ""}
      </div>
    </form>
    <div class="panel">
      <h3>Lista de alunos</h3>
      <div class="toolbar student-list-filters" aria-label="Filtros da lista de alunos">
        <input class="input" type="search" data-student-search placeholder="Pesquisar por nome ou usuário" aria-label="Pesquisar alunos por nome ou usuário">
        <select class="input" data-student-class-filter aria-label="Filtrar alunos por turma">
          <option value="">Todas as turmas</option>
          ${buildOptions(state.classes.map((item) => ({ value: item.name, label: item.name })))}
        </select>
      </div>
      <p class="muted" data-student-filter-status>${state.students.length} aluno(s) encontrado(s).</p>
      <div class="list-view scrollable-list student-list" data-students-list>
        ${
          state.students
            .slice()
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"))
            .map(
              (student) => `
                <article class="list-item" data-student-row data-student-name="${escapeHtml(normalizeLabel(student.name))}" data-student-user="${escapeHtml(normalizeLabel(student.user))}" data-student-class="${escapeHtml(normalizeLabel(getClassLabel(student.className)))}">
                  <div>
                    <strong>${escapeHtml(student.name)}</strong>
                    ${student.isJournalist ? '<span class="badge">Aluno jornalista</span>' : ""}
                    <p class="muted">${escapeHtml(getClassLabel(student.className))}${student.user ? ` | @${escapeHtml(student.user)}` : ""}</p>
                    <p class="muted">
                      ${getTeachersForClass(student.className).length ? `Professor(es): ${getTeachersForClass(student.className).map((teacher) => escapeHtml(teacher.name)).join(", ")}` : "Professor(es): não vinculado"}
                      <br>
                      ${getSubjectsForClass(student.className).length ? `Disciplina(s): ${getSubjectsForClass(student.className).map((subject) => escapeHtml(subject)).join(", ")}` : "Disciplina(s): não vinculada(s)"}
                    </p>
                  </div>
                  <div class="row-actions">
                    <button class="button ghost" type="button" data-student-edit data-id="${escapeHtml(student.id)}">Editar</button>
                    <button class="button ghost" type="button" data-student-reset-password data-id="${escapeHtml(student.id)}">Restaurar senha</button>
                    <button class="button ghost" type="button" data-student-delete data-id="${escapeHtml(student.id)}">Excluir</button>
                  </div>
                </article>
              `
            )
            .join("") || emptyState("Nenhum aluno cadastrado.")
        }
      </div>
    </div>
  `;

  let bulkStudents = [];
  const bulkFileInput = $("[data-student-bulk-file]");
  const bulkPreview = $("[data-student-bulk-preview]");
  const bulkImportButton = $("[data-student-bulk-import]");

  const studentSearch = $("[data-student-search]");
  const studentClassFilter = $("[data-student-class-filter]");
  const studentFilterStatus = $("[data-student-filter-status]");
  const applyStudentFilters = () => {
    const term = normalizeLabel(studentSearch?.value || "");
    const selectedClass = normalizeLabel(studentClassFilter?.value || "");
    let visible = 0;
    $$('[data-student-row]').forEach((row) => {
      const matchesTerm = !term || row.dataset.studentName.includes(term) || row.dataset.studentUser.includes(term);
      const matchesClass = !selectedClass || row.dataset.studentClass === selectedClass;
      const matches = matchesTerm && matchesClass;
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    if (studentFilterStatus) studentFilterStatus.textContent = `${visible} aluno(s) encontrado(s).`;
  };
  studentSearch?.addEventListener("input", applyStudentFilters);
  studentClassFilter?.addEventListener("change", applyStudentFilters);

  const updateBulkPreview = () => {
    if (!bulkStudents.length) {
      bulkPreview.innerHTML = `<p class="muted">Nenhum arquivo selecionado.</p>`;
      return;
    }
    bulkPreview.innerHTML = `
      <p class="muted">${bulkStudents.length} aluno(s) pronto(s) para importar.</p>
      <div class="list-view">
        ${bulkStudents
          .map(
            (student) => `
              <article class="list-item">
                <div>
                  <strong>${escapeHtml(student.name)}</strong>
                  <p class="muted">${escapeHtml(student.className)}${student.user ? ` | @${escapeHtml(student.user)}` : ""}</p>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  };

  if (bulkFileInput) {
    bulkFileInput.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".csv")) return toast("Selecione um arquivo CSV.");
      const text = await file.text();
      const fallbackClassName = parseFileClassName(file.name);
      bulkStudents = parseStudentCsvRows(text, fallbackClassName);
      if (!bulkStudents.length) {
        toast("O arquivo CSV não contém linhas válidas. Use as colunas name e className ou informe a turma no nome do arquivo.");
      }
      updateBulkPreview();
    });
  }

  if (bulkImportButton) {
    bulkImportButton.addEventListener("click", async () => {
      if (!bulkStudents.length) return toast("Selecione um arquivo CSV válido antes de importar.");
      const existingUsernames = new Set(state.students.map((student) => normalizeUser(student.user || "")));
      const existingStudents = new Set(state.students.map((student) => `${normalizeLabel(student.name)}|${normalizeLabel(student.className)}`));
      const rowsToInsert = bulkStudents
        .map((student) => {
          const key = `${normalizeLabel(student.name)}|${normalizeLabel(student.className)}`;
          if (existingStudents.has(key)) return null;
          const user = createStudentUsername(student.name, existingUsernames, student.user || "");
          existingStudents.add(key);
          return {
            id: makeId(),
            name: student.name,
            className: student.className,
            user,
            password: DEFAULT_STUDENT_PASSWORD,
            must_change_password: true,
            is_journalist: false
          };
        })
        .filter(Boolean);

      if (!rowsToInsert.length) return toast("Nenhum aluno novo para importar. Verifique se já existem alunos com os mesmos nome e turma.");

      const missingClasses = [...new Set(rowsToInsert.map((item) => item.className))].filter(
        (className) => !state.classes.some((cls) => normalizeLabel(cls.name) === normalizeLabel(className))
      );
      for (const className of missingClasses) {
        await upsertRecord("classes", { name: className }, "name", `Turma ${className} criada automaticamente.`);
      }

      const { error } = await supabase.from("students").insert(rowsToInsert);
      if (error) {
        console.error("Erro ao importar alunos em massa:", error);
        return toast("Erro ao importar alunos em massa.");
      }

      bulkStudents = [];
      bulkPreview.innerHTML = `<p class="muted">Importação concluída com ${rowsToInsert.length} aluno(s).</p>`;
      if (bulkFileInput) bulkFileInput.value = "";
      clearCache("students");
      await syncAdminData(`Importados ${rowsToInsert.length} aluno(s).`);
    });
  }

  $("[data-student-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const existingUsernames = new Set(state.students.filter((student) => !id || !idsEqual(student.id, id)).map((student) => normalizeUser(student.user || "")));
    const user = createStudentUsername(String(form.get("name") || ""), existingUsernames, id ? String(form.get("user") || "") : "");
    const payload = {
      id: id || makeId(),
      name: String(form.get("name") || "").trim(),
      className: String(form.get("className") || "").trim(),
      user,
      is_journalist: Boolean(form.get("isJournalist"))
    };
    if (!id) {
      payload.password = DEFAULT_STUDENT_PASSWORD;
      payload.must_change_password = true;
    }
    if (!payload.name || !payload.className) return toast("Informe nome e turma.");
    await upsertRecord("students", payload, "id", id ? "Aluno atualizado." : "Aluno salvo.");
    adminEditState.studentId = null;
  });

  const classSelect = $("[data-student-class-select]");
  const classInfo = $("[data-student-class-info]");
  if (classSelect && classInfo) {
    classSelect.addEventListener("change", () => {
      classInfo.innerHTML = renderClassLinkInfo(classSelect.value);
    });
  }

  const studentNameInput = $("[data-student-form] [name='name']");
  const studentUserInput = $("[data-student-form] [name='user']");
  studentNameInput?.addEventListener("input", () => {
    if (editing || !studentUserInput) return;
    studentUserInput.value = createStudentUsername(studentNameInput.value, new Set(state.students.map((student) => normalizeUser(student.user || ""))));
  });

  $$("[data-student-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      adminEditState.studentId = button.dataset.id;
      renderAdminContent();
    })
  );

  $$("[data-student-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord("students", "id", button.dataset.id, "Aluno removido.");
    })
  );

  $$('[data-student-reset-password]').forEach((button) =>
    button.addEventListener("click", async () => {
      const student = state.students.find((item) => idsEqual(item.id, button.dataset.id));
      if (!student) return;
      if (!window.confirm(`Restaurar a senha de ${student.name} para ${DEFAULT_STUDENT_PASSWORD}? O aluno deverá criar uma nova senha ao entrar.`)) return;
      const { error } = await supabase.from("students").update({ password: DEFAULT_STUDENT_PASSWORD, must_change_password: true }).eq("id", student.id);
      if (error) {
        console.error("Erro ao restaurar senha do aluno:", error);
        return toast("Não foi possível restaurar a senha.");
      }
      clearCache("students");
      await syncAdminData(`Senha de ${student.name} restaurada para ${DEFAULT_STUDENT_PASSWORD}.`);
    })
  );

  const cancel = $("[data-student-cancel]");
  if (cancel) {
    cancel.addEventListener("click", () => {
      adminEditState.studentId = null;
      renderAdminContent();
    });
  }
}

function renderTeachersAdmin(content) {
  const editing = adminEditState.teacherId ? state.teachers.find((item) => idsEqual(item.id, adminEditState.teacherId)) : null;
  const editingPairs = editing ? getTeacherSubjectClassPairs(editing) : [];
  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Professores</h2>
        <p class="muted">Defina exatamente qual disciplina o professor leciona em cada turma.</p>
      </div>
    </div>
    <form class="panel contact-form" data-teacher-form>
      <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}">
      <label>Nome<input class="input" name="name" value="${escapeHtml(editing?.name || "")}" required></label>
      <fieldset class="choice-field">
        <legend>Disciplinas e turmas</legend>
        <p class="muted">Marque, em cada disciplina, todas as turmas nas quais ela será lecionada.</p>
        <div class="assignment-matrix">
          ${state.subjects.map((subject) => `
            <div class="assignment-row">
              <strong>${escapeHtml(subject.name)}</strong>
              <div class="choice-buttons">
                ${state.classes.map((classItem) => {
                  const checked = editingPairs.some((pair) => normalizeLabel(pair.subject) === normalizeLabel(subject.name) && normalizeLabel(pair.className) === normalizeLabel(classItem.name));
                  return `<label class="choice-button"><input type="checkbox" name="assignment" data-subject="${escapeHtml(subject.name)}" data-class="${escapeHtml(classItem.name)}"${checked ? " checked" : ""}><span>${escapeHtml(classItem.name)}</span></label>`;
                }).join("") || '<span class="muted">Cadastre turmas no Catálogo.</span>'}
              </div>
            </div>`).join("") || '<span class="muted">Cadastre disciplinas no Catálogo.</span>'}
        </div>
      </fieldset>
      <label>Usuário<input class="input" name="user" value="${escapeHtml(editing?.user || "")}"></label>
      <label>Senha<input class="input" name="password" type="text" value="${escapeHtml(editing?.password || "")}" placeholder="${editing ? "" : "1234"}"></label>
      <div class="row-actions">
        <button class="button primary" type="submit">${editing ? "Atualizar professor" : "Salvar professor"}</button>
        ${editing ? '<button class="button ghost" type="button" data-teacher-cancel>Cancelar edição</button>' : ""}
      </div>
    </form>
    <div class="panel">
      <h3>Lista de professores</h3>
      <div class="list-view">
        ${
          state.teachers
            .map(
              (teacher) => `
                <article class="list-item">
                  <div>
                    <strong>${escapeHtml(teacher.name)}</strong>
                    <p class="muted">Vínculos: ${escapeHtml(formatTeacherAssignments(teacher) || "Nenhum vínculo")}</p>
                  </div>
                  <div class="row-actions">
                    <button class="button ghost" type="button" data-teacher-edit data-id="${escapeHtml(teacher.id)}">Editar</button>
                    <button class="button ghost" type="button" data-teacher-delete data-id="${escapeHtml(teacher.id)}">Excluir</button>
                  </div>
                </article>
              `
            )
            .join("") || emptyState("Nenhum professor cadastrado.")
        }
      </div>
    </div>
  `;

  $("[data-teacher-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const assignments = $$('input[name="assignment"]:checked', event.target).map((input) => ({
      subject: input.dataset.subject,
      className: input.dataset.class
    }));
    const subjects = [...new Set(assignments.map((item) => item.subject))];
    const classes = [...new Set(assignments.map((item) => item.className))];
    let password = String(form.get("password") || "").trim();
    if (!password && !id) password = "1234";
    const payload = {
      id: id || makeId(),
      name: String(form.get("name") || "").trim(),
      subject: subjects.join(", "),
      classes,
      user: String(form.get("user") || "").trim() || null,
      password: password || null
    };
    if (!payload.name || !assignments.length) return toast("Informe o nome e vincule ao menos uma disciplina a uma turma.");
    const saved = await upsertRecord("teachers", payload, "id", id ? "Professor atualizado." : "Professor salvo.");
    if (!saved) return;
    try {
      await replaceTeacherAssignments(payload.id, assignments);
      await syncAdminData("Vínculos de disciplinas e turmas salvos.");
      adminEditState.teacherId = null;
    } catch (error) {
      console.error("Erro ao salvar vínculos:", error);
      toast("Execute a migração do banco para salvar os vínculos por turma.");
    }
  });

  $$("[data-teacher-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      adminEditState.teacherId = button.dataset.id;
      renderAdminContent();
    })
  );

  $$("[data-teacher-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord("teachers", "id", button.dataset.id, "Professor removido.");
    })
  );

  const cancel = $("[data-teacher-cancel]");
  if (cancel) {
    cancel.addEventListener("click", () => {
      adminEditState.teacherId = null;
      renderAdminContent();
    });
  }
}

function gradeTemplate() {
  return {
    1: { n1: 0, n2: 0, n3: 0, recovery: false },
    2: { n1: 0, n2: 0, n3: 0, recovery: false },
    3: { n1: 0, n2: 0, n3: 0, recovery: false }
  };
}

function renderGradesAdmin(content) {
  const editing = adminEditState.gradeId ? state.grades.find((item) => item.id === adminEditState.gradeId) : null;
  const trimestersJson = editing ? JSON.stringify(editing.trimesters || gradeTemplate(), null, 2) : JSON.stringify(gradeTemplate(), null, 2);
  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Notas</h2>
        <p class="muted">Administre registros de notas e recuperação diretamente no banco.</p>
      </div>
    </div>
    <form class="panel contact-form" data-grade-form>
      <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}">
      <label>Aluno
        <select class="input" name="studentId" required>
          <option value="">Selecione</option>
          ${buildOptions(
            state.students.map((student) => ({ value: student.id, label: `${student.name} - ${getClassLabel(student.className)}` })),
            editing?.studentId || ""
          )}
        </select>
      </label>
      <label>Disciplina
        <select class="input" name="subject" required>
          <option value="">Selecione</option>
          ${buildOptions(state.subjects.map((item) => ({ value: item.name, label: item.name })), getSubjectLabel(editing?.subject || ""))}
        </select>
      </label>
      <label>Turma
        <select class="input" name="classname" required>
          <option value="">Selecione</option>
          ${buildOptions(state.classes.map((item) => ({ value: item.name, label: item.name })), getClassLabel(editing?.className || editing?.classname || ""))}
        </select>
      </label>
      <label>Trimestres JSON<textarea class="input" name="trimesters" rows="10" required>${escapeHtml(trimestersJson)}</textarea></label>
      <div class="row-actions">
        <button class="button primary" type="submit">${editing ? "Atualizar nota" : "Salvar nota"}</button>
        ${editing ? '<button class="button ghost" type="button" data-grade-cancel>Cancelar edição</button>' : ""}
      </div>
    </form>
    <div class="panel">
      <h3>Lista de notas</h3>
      <div class="table-scroll">
        <table class="report-table">
          <thead>
            <tr><th>Aluno</th><th>Disciplina</th><th>Turma</th><th>Média</th><th>Ações</th></tr>
          </thead>
          <tbody>
            ${
              state.grades
                .map((grade) => {
                  const student = state.students.find((item) => item.id === grade.studentId);
                  return `
                    <tr>
                      <td>${escapeHtml(student?.name || "Aluno removido")}</td>
                      <td>${escapeHtml(getSubjectLabel(grade.subject))}</td>
                      <td>${escapeHtml(getClassLabel(grade.className))}</td>
                      <td>${gradeAverage(grade)}</td>
                      <td>
                        <div class="row-actions">
                          <button class="button ghost" type="button" data-grade-edit data-id="${escapeHtml(grade.id)}">Editar</button>
                          <button class="button ghost" type="button" data-grade-delete data-id="${escapeHtml(grade.id)}">Excluir</button>
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join("") || `<tr><td colspan="5">Nenhuma nota cadastrada.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  $("[data-grade-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const trimesters = safeJson(String(form.get("trimesters") || ""), gradeTemplate());
    const payload = {
      id: id || makeId(),
      studentid: String(form.get("studentId") || "").trim(),
      subject: String(form.get("subject") || "").trim(),
      className: String(form.get("classname") || "").trim(),
      trimesters: trimesters
    };
    if (!payload.studentid || !payload.subject || !payload.className) return toast("Preencha todos os campos.");
    await upsertRecord("grades", payload, "id", id ? "Nota atualizada." : "Nota salva.");
    adminEditState.gradeId = null;
  });

  $$("[data-grade-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      adminEditState.gradeId = button.dataset.id;
      renderAdminContent();
    })
  );

  $$("[data-grade-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord("grades", "id", button.dataset.id, "Nota removida.");
    })
  );

  const cancel = $("[data-grade-cancel]");
  if (cancel) {
    cancel.addEventListener("click", () => {
      adminEditState.gradeId = null;
      renderAdminContent();
    });
  }
}

function renderContentAdmin(content) {
  content.innerHTML = `
    <div class="portal-heading">
      <div>
        <h2>Conteúdo público</h2>
        <p class="muted">Gerencie notícias, eventos, atividades e conquistas em um único painel.</p>
      </div>
    </div>
    <div class="segmented" role="tablist" aria-label="Conteúdo do site">
      ${["news", "events", "activities", "achievements"]
        .map((tab) => `<button type="button" data-content-tab="${tab}" class="${currentAdminContentTab === tab ? "active" : ""}">${tabLabel(tab)}</button>`)
        .join("")}
    </div>
    <div data-content-editor></div>
  `;

  $$("[data-content-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      currentAdminContentTab = button.dataset.contentTab;
      renderAdminContent();
    })
  );

  renderContentEditor($("[data-content-editor]"));
}

function renderContentEditor(root) {
  const type = currentAdminContentTab;
  const collection =
    type === "news" ? state.news : type === "events" ? state.events : type === "activities" ? state.activities : state.achievements;
  const editing = adminEditState.contentId ? collection.find((item) => idsEqual(item.id, adminEditState.contentId)) : null;
  const titleLabel = { news: "Notícia", events: "Evento", activities: "Atividade", achievements: "Conquista" }[type];
  const nameField = type === "events" ? "title" : type === "activities" ? "name" : "title";
  const defaultPayload =
    type === "news"
      ? { title: "", summary: "", content: "", category: "", author: "", date: new Date().toISOString().slice(0, 10), published: true }
      : type === "events"
      ? { title: "", description: "", date: "", time: "", location: "" }
      : type === "activities"
      ? { name: "", description: "", category: "" }
      : { title: "", description: "", category: "" };
  const item = editing || defaultPayload;
  let selectedFiles = Array.isArray(item.files) ? [...item.files] : [];

  root.innerHTML = `
    <form class="panel contact-form" data-content-form>
      <input type="hidden" name="id" value="${escapeHtml(item.id || "")}">
      <label>${titleLabel} principal<input class="input" name="${nameField}" value="${escapeHtml(item[nameField] || "")}" required></label>
      ${
        type === "news"
          ? `
            <label>Resumo<textarea class="input" name="summary" rows="3">${escapeHtml(item.summary || "")}</textarea></label>
            <label>Conteúdo<textarea class="input" name="content" rows="6">${escapeHtml(item.content || "")}</textarea></label>
            <label>Categoria<input class="input" name="category" value="${escapeHtml(item.category || "")}"></label>
            <label>Autor<input class="input" name="author" value="${escapeHtml(item.author || "")}"></label>
            <label>Data<input class="input" name="date" type="date" value="${escapeHtml(item.date || "")}" required></label>
            <label class="checkbox-row"><input type="checkbox" name="published"${item.published ? " checked" : ""}> Publicado</label>
          `
          : type === "events"
          ? `
            <label>Descrição<textarea class="input" name="description" rows="4">${escapeHtml(item.description || "")}</textarea></label>
            <label>Data<input class="input" name="date" type="date" value="${escapeHtml(item.date || "")}" required></label>
            <label>Horário<input class="input" name="time" value="${escapeHtml(item.time || "")}"></label>
            <label>Local<input class="input" name="location" value="${escapeHtml(item.location || "")}"></label>
          `
          : `
            <label>Descrição<textarea class="input" name="description" rows="4">${escapeHtml(item.description || "")}</textarea></label>
            <label>Categoria<input class="input" name="category" value="${escapeHtml(item.category || "")}"></label>
          `
      }
      ${type === "news" || type === "activities" ? `
        <fieldset class="upload-zone">
          <legend>Imagens, vídeos e arquivos</legend>
          <p>Escolha arquivos da câmera, galeria ou dispositivo.</p>
          <input class="input" data-content-files type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" multiple>
          <small class="muted">Até 10 MB por arquivo e 25 MB no total.</small>
          <div class="attachment-list" data-attachment-list>${attachmentEditor(selectedFiles)}</div>
        </fieldset>
      ` : ""}
      <div class="row-actions">
        <button class="button primary" type="submit">${editing ? `Atualizar ${titleLabel.toLowerCase()}` : `Salvar ${titleLabel.toLowerCase()}`}</button>
        ${editing ? '<button class="button ghost" type="button" data-content-cancel>Cancelar edição</button>' : ""}
      </div>
    </form>
    <div class="panel">
      <h3>Itens cadastrados</h3>
      <div class="list-view">
        ${
          collection
            .map(
              (entry) => `
                <article class="list-item">
                  <div>
                    <strong>${escapeHtml(entry[nameField])}</strong>
                    <p class="muted">${escapeHtml(entry.category || entry.author || entry.location || entry.time || "")}</p>
                  </div>
                  <div class="row-actions">
                    ${
                      type === "news"
                        ? `<button class="button ghost" type="button" data-content-toggle data-id="${escapeHtml(entry.id)}">${entry.published ? "Despublicar" : "Publicar"}</button>`
                        : ""
                    }
                    <button class="button ghost" type="button" data-content-edit data-id="${escapeHtml(entry.id)}">Editar</button>
                    <button class="button ghost" type="button" data-content-delete data-id="${escapeHtml(entry.id)}">Excluir</button>
                  </div>
                </article>
              `
            )
            .join("") || emptyState(`Nenhuma ${titleLabel.toLowerCase()} cadastrada.`)
        }
      </div>
    </div>
  `;

  const attachmentList = $("[data-attachment-list]", root);
  const refreshAttachments = () => {
    if (!attachmentList) return;
    attachmentList.innerHTML = attachmentEditor(selectedFiles);
    $$("[data-remove-attachment]", attachmentList).forEach((button) =>
      button.addEventListener("click", () => {
        selectedFiles.splice(Number(button.dataset.removeAttachment), 1);
        refreshAttachments();
      })
    );
  };
  refreshAttachments();

  const fileInput = $("[data-content-files]", root);
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      try {
        selectedFiles = await readAttachments(fileInput.files, selectedFiles);
        fileInput.value = "";
        refreshAttachments();
      } catch (error) {
        toast(error.message || "Erro ao carregar arquivo.");
      }
    });
  }

  $("[data-content-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const base = id ? { id } : {};
    let payload = base;

    if (type === "news") {
      payload = {
        ...base,
        title: String(form.get("title") || "").trim(),
        summary: String(form.get("summary") || "").trim(),
        content: String(form.get("content") || "").trim(),
        category: String(form.get("category") || "").trim(),
        author: String(form.get("author") || "").trim(),
        date: String(form.get("date") || "").trim(),
        published: Boolean(form.get("published")),
        files: selectedFiles
      };
    } else if (type === "events") {
      payload = {
        ...base,
        title: String(form.get("title") || "").trim(),
        description: String(form.get("description") || "").trim(),
        date: String(form.get("date") || "").trim(),
        time: String(form.get("time") || "").trim(),
        location: String(form.get("location") || "").trim()
      };
    } else if (type === "activities") {
      payload = {
        ...base,
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        category: String(form.get("category") || "").trim(),
        files: selectedFiles
      };
    } else {
      payload = {
        ...base,
        title: String(form.get("title") || "").trim(),
        description: String(form.get("description") || "").trim(),
        category: String(form.get("category") || "").trim()
      };
    }

    if ((type === "news" || type === "events") && !payload.title) return toast(`Informe o título da ${titleLabel.toLowerCase()}.`);
    if ((type === "activities" || type === "achievements") && !((payload.name || payload.title) || "")) {
      return toast(`Informe o nome ou título da ${titleLabel.toLowerCase()}.`);
    }

    const table = type;
    const saved = await upsertRecord(table, payload, "id", id ? `${titleLabel} atualizado.` : `${titleLabel} salvo.`);
    if (saved) adminEditState.contentId = null;
  });

  $$("[data-content-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      adminEditState.contentId = button.dataset.id;
      renderAdminContent();
    })
  );

  $$("[data-content-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteRecord(type, "id", button.dataset.id, `${titleLabel} removido.`);
    })
  );

  $$("[data-content-toggle]").forEach((button) =>
    button.addEventListener("click", async () => {
      try {
        const item = state.news.find((entry) => idsEqual(entry.id, button.dataset.id));
        if (!item) return;
        const { error } = await supabase.from("news").update({ published: !item.published }).eq("id", item.id);
        if (error) throw error;
        clearCache("news");
        await syncAdminData(item.published ? "Notícia despublicada." : "Notícia publicada.");
      } catch (error) {
        console.error("Erro ao alternar publicação:", error);
        toast("Erro ao alterar publicação.");
      }
    })
  );

  const cancel = $("[data-content-cancel]");
  if (cancel) {
    cancel.addEventListener("click", () => {
      adminEditState.contentId = null;
      renderAdminContent();
    });
  }
}

function renderRecoveryCell(grade, trimester, student) {
  const regularAverage = getTrimesterRegularAverage(grade, trimester);
  const recoveryScore = getTrimesterRecoveryScore(grade, trimester);
  const approved = Number(getTrimesterFinalAverage(grade, trimester)) >= 6;

  if (!recoveryScore && approved) {
    return `<span class="badge success">Aprovado</span>`;
  }

  const label = trimester === "3" ? "Recuperação final" : "Recuperação";
  return `
    <div class="recovery-slot">
      <span class="muted">${label}</span>
      <input class="input" data-recovery-input name="rec-${student.id}" type="number" min="0" max="10" step="0.1" value="${recoveryScore || ""}" placeholder="Nota" ${
        regularAverage >= 6 && !recoveryScore ? "disabled" : ""
      }>
    </div>
  `;
}

function teacherStudentRow(student, teacher, trimester, subject, className) {
  const grade = state.grades.find(
    (g) =>
      idsEqual(g.studentId, student.id) &&
      getSubjectLabel(g.subject) === getSubjectLabel(subject) &&
      getClassLabel(g.className) === getClassLabel(className)
  ) || {
    trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
  };

  const trimesterData = getTrimester(grade, trimester);
  const average = getTrimesterFinalAverage(grade, trimester);
  const statusText = hasTrimesterScores(grade, trimester) ? getTrimesterStatusText(grade, trimester) : "Pendente";
  const approved = Number(average) >= 6;

  return `
    <div class="gradebook-row" data-grade-row data-student-id="${escapeHtml(student.id)}" data-trimester="${trimester}">
      <div>
        <strong>${escapeHtml(student.name)}</strong>
        <small>Turma ${escapeHtml(getClassLabel(className))}</small>
      </div>
      <input class="input" name="n1-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n1 || ""}" data-score-input="n1">
      <input class="input" name="n2-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n2 || ""}" data-score-input="n2">
      <input class="input" name="n3-${student.id}" type="number" min="0" max="10" step="0.1" value="${trimesterData.n3 || ""}" data-score-input="n3">
      <div data-recovery-cell>${renderRecoveryCell(grade, trimester, student)}</div>
      <strong data-average>${average}</strong>
      <span class="badge ${approved ? "success" : "warning"}" data-status>${statusText}</span>
    </div>
  `;
}

function setupTeacherGradeLivePreview(teacher, trimester, subject, className) {
  $$("[data-grade-row]").forEach((row) => {
    const studentId = row.dataset.studentId;
    const student = state.students.find((item) => item.id === studentId);
    if (!student) return;

    const baseGrade = state.grades.find(
      (g) =>
        idsEqual(g.studentId, student.id) &&
        getSubjectLabel(g.subject) === getSubjectLabel(subject) &&
        getClassLabel(g.className) === getClassLabel(className)
    ) || {
      studentId: student.id,
      subject,
      className: getClassLabel(className),
      trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
    };

    const updateRow = () => {
      const n1 = row.querySelector('[data-score-input="n1"]')?.value || 0;
      const n2 = row.querySelector('[data-score-input="n2"]')?.value || 0;
      const n3 = row.querySelector('[data-score-input="n3"]')?.value || 0;
      const currentRecovery = row.querySelector('[data-recovery-input]')?.value || getTrimester(baseGrade, trimester).recoveryScore || 0;
      const snapshot = getGradeSnapshot(baseGrade, trimester, { n1, n2, n3, recoveryScore: currentRecovery });
      const average = getTrimesterFinalAverage(snapshot, trimester);
      const status = hasTrimesterScores(snapshot, trimester) ? getTrimesterStatusText(snapshot, trimester) : "Pendente";
      const approved = Number(average) >= 6;

      const averageEl = row.querySelector("[data-average]");
      const statusEl = row.querySelector("[data-status]");
      const recoveryCell = row.querySelector("[data-recovery-cell]");

      if (averageEl) averageEl.textContent = average;
      if (statusEl) {
        statusEl.textContent = status;
        statusEl.className = `badge ${approved ? "success" : "warning"}`;
      }
      if (recoveryCell) recoveryCell.innerHTML = renderRecoveryCell(snapshot, trimester, student);
    };

    row.querySelectorAll("[data-score-input]").forEach((input) => {
      input.addEventListener("input", updateRow);
    });

    row.addEventListener("input", (event) => {
      if (event.target.matches("[data-recovery-input]")) {
        updateRow();
      }
    });

    updateRow();
  });
}

function teacherReportTable(teacher, grades, subject, className) {
  const rows = grades
    .map((grade) => {
      const student = state.students.find((item) => item.id === grade.studentId);
      const t1Final = getTrimesterFinalAverage(grade, "1");
      const t2Final = getTrimesterFinalAverage(grade, "2");
      const t3Final = getTrimesterFinalAverage(grade, "3");
      const overallStatus = hasTrimesterScores(grade, "3")
        ? Number(gradeAverage(grade)) >= 6
          ? "Aprovado"
          : "Recuperação final"
        : hasTrimesterScores(grade, "1") || hasTrimesterScores(grade, "2")
        ? "Em andamento"
        : "Pendente";
      return `
        <tr>
          <td>${escapeHtml(student?.name || "Aluno")}</td>
          <td>${escapeHtml(getClassLabel(grade.className))}</td>
          <td>${t1Final}</td>
          <td>${t2Final}</td>
          <td>${t3Final}</td>
          <td>${gradeAverage(grade)}</td>
          <td>${overallStatus}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="report-table">
        <thead>
          <tr><th>Aluno</th><th>Turma</th><th>1T</th><th>2T</th><th>3T</th><th>Final</th><th>Situação</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">Nenhuma nota registrada em ${escapeHtml(subject || getSubjectLabel(teacher.subject))} para ${escapeHtml(className || "")}.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function trimesterMiniTable(grade, trimester) {
  const average = getTrimesterFinalAverage(grade, trimester);
  const recoveryScore = getTrimesterRecoveryScore(grade, trimester);
  const approved = Number(average) >= 6;
  const recoveryStatus = recoveryScore > 0 ? " - RECUPERACAO" : approved ? " - APROVADO" : "";
  return `
    <div class="trimester-mini">
      <strong>${trimester} trimestre${recoveryStatus}</strong>
      <span>N1 ${Number(getTrimester(grade, trimester).n1).toFixed(1)}</span>
      <span>N2 ${Number(getTrimester(grade, trimester).n2).toFixed(1)}</span>
      <span>N3 ${Number(getTrimester(grade, trimester).n3).toFixed(1)}</span>
      <span>Média ${average}</span>
    </div>
  `;
}

function studentGradeCardV2(grade) {
  const average = gradeAverage(grade);
  const t1Approved = Number(getTrimesterFinalAverage(grade, "1")) >= 6;
  const t2Approved = Number(getTrimesterFinalAverage(grade, "2")) >= 6;
  const t3Approved = Number(getTrimesterFinalAverage(grade, "3")) >= 6;

  return `
    <article class="panel grade-card">
      <div class="grade-card-head">
        <div>
          <span class="badge">${escapeHtml(getSubjectLabel(grade.subject))}</span>
          <h3>Média final ${average}</h3>
        </div>
        <strong class="badge ${Number(average) >= 6 ? "success" : "warning"}">${Number(average) >= 6 ? "Aprovado" : "Recuperação"}</strong>
      </div>
      <div class="grade-chart" aria-label="Grafico de notas">
        ${gradeBar("1T", t1Approved ? getTrimesterFinalAverage(grade, "1") : trimesterAverage(grade, "1"), getTrimesterRecoveryScore(grade, "1") > 0)}
        ${gradeBar("2T", t2Approved ? getTrimesterFinalAverage(grade, "2") : trimesterAverage(grade, "2"), getTrimesterRecoveryScore(grade, "2") > 0)}
        ${gradeBar("3T", t3Approved ? getTrimesterFinalAverage(grade, "3") : trimesterAverage(grade, "3"), getTrimesterRecoveryScore(grade, "3") > 0)}
        ${gradeBar("Média", average, false)}
      </div>
      <div class="trimester-grid">
        ${["1", "2", "3"].map((trimester) => trimesterMiniTableV2(grade, trimester)).join("")}
      </div>
    </article>
  `;
}

function studentReportTableV2(grades, allComplete, finalRecovery) {
  const rows = grades
    .map((grade) => {
      const t1Status = getTrimesterStatusText(grade, "1");
      const t2Status = getTrimesterStatusText(grade, "2");
      const t3Status = getTrimesterStatusText(grade, "3");
      return `
        <tr>
          <td>${escapeHtml(getSubjectLabel(grade.subject))}</td>
          <td>${getTrimesterFinalAverage(grade, "1")}</td>
          <td>${getTrimesterFinalAverage(grade, "2")}</td>
          <td>${getTrimesterFinalAverage(grade, "3")}</td>
          <td>${gradeAverage(grade)}</td>
          <td>${
            allComplete
              ? t1Status === "Aprovado" && t2Status === "Aprovado" && t3Status === "Aprovado"
                ? "Aprovado"
                : finalRecovery
                ? "Recuperação final"
                : "Recuperação"
              : "Pendente"
          }</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="report-table">
        <thead>
          <tr><th>Disciplina</th><th>1T</th><th>2T</th><th>3T</th><th>Final</th><th>Situação</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6">Nenhuma nota registrada.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

// ==================== PREFERÊNCIAS E UI ====================
function setupPreferences() {
  // O tema acompanha exclusivamente a preferência de aparência do sistema operacional.
  document.documentElement.removeAttribute("data-theme");
  localStorage.removeItem("theme");
}

function setupUi() {
  $("[data-menu-toggle]").addEventListener("click", () => {
    $("[data-nav-panel]").classList.toggle("open");
    document.body.classList.toggle("no-scroll");
  });

  $$('[data-calendar-view]').forEach((button) =>
    button.addEventListener("click", () => {
      currentCalendarView = button.dataset.calendarView;
      renderCalendar();
    })
  );

  setInterval(() => {
    const media = $("[data-hero-media]");
    if (media) media.style.backgroundPosition = `${50 + Math.sin(Date.now() / 2500) * 3}% center`;
  }, 500);
}

// ==================== INICIALIZAÇÃO ====================
async function refreshDataInBackground() {
  if (document.hidden) return;
  const updated = await loadDataFromSupabase({ useCache: true, forceNetwork: true });
  if (!updated) return;
  renderPublic();
  if ((location.hash || "").replace("#", "").split("?")[0] === "noticia") renderNewsDetail();
}

window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", async () => {
  document.title = `${SCHOOL_TITLE} | Portal`;
  await loadDataFromSupabase({ useCache: true });
  renderPublic();
  setupUi();
  setupPreferences();
  route();
  void refreshDataInBackground();
  window.setInterval(refreshDataInBackground, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshDataInBackground();
  });
});
