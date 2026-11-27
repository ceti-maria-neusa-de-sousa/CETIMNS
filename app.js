import { supabase, fetchWithCache, clearCache } from "./supabase.js?v=20261127-support-performance";

console.log("App carregado!");
console.log("Supabase:", supabase);

const SESSION_KEY = "ceti_admin_session";
const SCHOOL_LOGO = "logo-ceti.png";
const SCHOOL_TITLE = "CETI Maria Neusa de Sousa";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_SIZE = 25 * 1024 * 1024;
const DEFAULT_STUDENT_PASSWORD = "1234";
const DEFAULT_SCHOOL_HISTORY = "O CETI Maria Neusa de Sousa, localizado em Francisco Macedo, no Piauí, é uma escola pública de tempo integral comprometida com uma educação acolhedora, inclusiva e transformadora. Sua trajetória foi construída com a participação de estudantes, famílias, educadores e comunidade, que reconhecem na escola um espaço de aprendizado, convivência e construção de projetos de vida. Ao longo dos anos, a instituição vem ampliando suas ações pedagógicas, culturais, esportivas e tecnológicas, valorizando os saberes locais e preparando os estudantes para os desafios do presente e do futuro. Com uma equipe dedicada, o CETI busca formar cidadãos críticos, responsáveis e solidários, capazes de contribuir de forma positiva para a sociedade.";
const LEGACY_SCHOOL_HISTORY = "CETI Maria Neusa de Sousa - Centro Estadual de Tempo Integral";
const makeId = () => crypto.randomUUID();
const normalizeUser = (value) => String(value ?? "").trim().toLowerCase();
const normalizePassword = (value) => String(value ?? "").trim();
const idsEqual = (left, right) => String(left ?? "") === String(right ?? "");

let state = {
  classes: [],
  subjects: [],
  students: [],
  teachers: [],
  staff: [],
  notifications: [],
  notificationDismissals: [],
  workTasks: [],
  workTaskAssignees: [],
  sectorChecklists: [],
  sectorChecklistItems: [],
  sectorChecklistCompletions: [],
  sectorChecklistAssignees: [],
  sectorRecords: [],
  kitchenMenu: [],
  kitchenStock: [],
  dietaryRestrictions: [],
  supportRequests: [],
  supportMessages: [],
  studentDocuments: [],
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
    history: DEFAULT_SCHOOL_HISTORY,
    mission: "",
    vision: "",
    values: ""
  },
  contact: {
    address: "",
    phone: "",
    email: ""
  },
  team: [],
  schoolConfigId: null
};

let currentCalendarView = "month";
let currentCalendarDate = new Date();
let currentAdminTab = "dashboard";
let currentAdminContentTab = "news";
let currentTeacherTrimester = "1";
let currentTeacherSubject = "";
let currentTeacherClass = "";
let currentStudentView = "bulletin";
let currentStaffView = "overview";
let currentKitchenView = "operations";
let editingSectorChecklistId = null;
let isRefreshingData = false;
let isSavingRecord = false;
let requiredDataLoadErrors = 0;
let supportMessagesLoaded = false;
const loadedSupportMessageRequestIds = new Set();
const supportMessagesLoadPromises = new Map();
const notificationDismissalSyncAttempts = new Set();
// Impede que a atualização automática substitua um formulário em edição.
let hasUnsavedFormChanges = false;
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
const sortPeopleByName = (people) =>
  [...people].sort((left, right) =>
    String(left.name || "").localeCompare(String(right.name || ""), "pt-BR", { sensitivity: "base" })
  );
const sortGradesByStudentName = (grades) =>
  [...grades].sort((left, right) => {
    const leftName = state.students.find((student) => idsEqual(student.id, left.studentId))?.name || "";
    const rightName = state.students.find((student) => idsEqual(student.id, right.studentId))?.name || "";
    return leftName.localeCompare(rightName, "pt-BR", { sensitivity: "base" });
  });
const getExistingUsernames = (excludedId = null) =>
  new Set(
    [...state.students, ...state.teachers, ...state.staff]
      .filter((person) => !excludedId || !idsEqual(person.id, excludedId))
      .map((person) => normalizeUser(person.user || ""))
      .filter(Boolean)
  );

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
  const preferred = normalizeUser(preferredUser || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  const nameParts = (normalizeUser(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) || []).filter((part, index) => index === 0 || !["da", "das", "de", "do", "dos", "e"].includes(part));
  const nameBases = nameParts.map((_, index) => nameParts.slice(0, index + 1).join(""));
  const bases = [...new Set(preferred ? [preferred, ...nameBases] : nameBases)];

  for (const base of bases) {
    if (base && !existingUsernames.has(base)) {
      existingUsernames.add(base);
      return base;
    }
  }

  const base = bases.at(-1) || "aluno";
  let counter = 2;
  let user = `${base}${counter}`;
  while (existingUsernames.has(user)) user = `${base}${++counter}`;
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
  const n1Num = parseGradeScore(n1) || 0;
  const n2Num = parseGradeScore(n2) || 0;
  const n3Num = parseGradeScore(n3) || 0;
  
  if (n1Num === 0 && n2Num === 0 && n3Num === 0) return false;
  
  const average = (n1Num + n2Num + n3Num) / 3;
  return average < 6;
}

function getTrimesterAverage(n1, n2, n3) {
  const n1Num = parseGradeScore(n1) || 0;
  const n2Num = parseGradeScore(n2) || 0;
  const n3Num = parseGradeScore(n3) || 0;
  
  if (n1Num === 0 && n2Num === 0 && n3Num === 0) return "0.0";
  
  return ((n1Num + n2Num + n3Num) / 3).toFixed(1);
}

function normalizeTrimester(trimester = {}) {
  const n1 = parseGradeScore(trimester.n1) || 0;
  const n2 = parseGradeScore(trimester.n2) || 0;
  const n3 = parseGradeScore(trimester.n3) || 0;
  const recoveryScore = parseGradeScore(trimester.recoveryScore) || 0;
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
  const studentGrades = state.grades.filter((g) => idsEqual(g.studentId, studentId));
  return studentGrades.length > 0 && studentGrades.every(
    (g) =>
      getTrimesterFinalAverage(g, "1") !== "0.0" &&
      getTrimesterFinalAverage(g, "2") !== "0.0" &&
      getTrimesterFinalAverage(g, "3") !== "0.0"
  );
}

function isStudentApprovedForYear(student) {
  const studentGrades = state.grades.filter((grade) => idsEqual(grade.studentId, student.id));
  return studentGrades.length > 0 && hasAllGrades(student.id) && studentGrades.every((grade) => Number(gradeAverage(grade)) >= 6);
}

function studentYearStatus(student) {
  if (student.isGraduated || student.is_graduated) return "Formado";
  return isStudentApprovedForYear(student) ? "Aprovado" : "Em andamento / pendente";
}

function isFinalYearClass(className) {
  // Aceita nomenclaturas como "3º Ano", "3o ano", "3ª série" e "3 A".
  return /^\s*3\s*(?:º|ª|o|a)?(?:\s|$)/i.test(String(className || ""));
}

// ==================== FUNÇÕES DE DADOS ====================
async function loadDataFromSupabase({ useCache = false, forceNetwork = false, allowStaleCache = false, onStaleCache, onCacheUsed, skipIfUnsaved = false } = {}) {
  try {
    if (isRefreshingData) return false;
    isRefreshingData = true;
    requiredDataLoadErrors = 0;
    console.log("Carregando dados do Supabase...");

    const loadTable = (table, transform, optional) => {
      const request = () => safeTableSelect(table, transform, optional);
      const load = () => useCache ? fetchWithCache(table, "all", request, {
        force: forceNetwork || table === "teacher_assignments",
        allowStale: allowStaleCache,
        onStale: onStaleCache,
        onCache: onCacheUsed
      }) : request();
      if (!optional) return load();
      return load().catch((error) => {
        console.warn(`Erro ao buscar tabela opcional ${table}:`, error);
        return [];
      });
    };
    const [classesData, subjectsData, studentsData, teachersData, staffData, notificationsData, notificationDismissalsData, workTasksData, workTaskAssigneesData, sectorChecklistsData, sectorChecklistItemsData, sectorChecklistCompletionsData, sectorChecklistAssigneesData, sectorRecordsData, kitchenMenuData, kitchenStockData, dietaryRestrictionsData, supportRequestsData, studentDocumentsData, teacherAssignmentsData, gradesData, newsData, eventsData, activitiesData, achievementsData, configData] = await Promise.all([
      loadTable("classes"),
      loadTable("subjects"),
      loadTable("students"),
      loadTable("teachers"),
      loadTable("staff", undefined, true),
      loadTable("private_notifications", undefined, true),
      loadTable("notification_dismissals", undefined, true),
      loadTable("work_tasks", undefined, true),
      loadTable("work_task_assignees", undefined, true),
      loadTable("sector_checklists", undefined, true),
      loadTable("sector_checklist_items", undefined, true),
      loadTable("sector_checklist_completions", undefined, true),
      loadTable("sector_checklist_assignees", undefined, true),
      loadTable("sector_records", undefined, true),
      loadTable("kitchen_menu", undefined, true),
      loadTable("kitchen_stock", undefined, true),
      loadTable("dietary_restrictions", undefined, true),
      loadTable("support_requests", undefined, true),
      loadTable("student_documents", undefined, true),
      loadTable("teacher_assignments", undefined, true),
      loadTable("grades"),
      loadTable("news"),
      loadTable("events"),
      loadTable("activities"),
      loadTable("achievements"),
      loadTable("school_config", (query) => query.order("created_at", { ascending: false }).limit(1))
    ]);

    // Não substitui o estado atual por listas vazias se a rede ou o banco
    // falhar. Isso evitava que um usuário logado fosse removido do painel.
    if (requiredDataLoadErrors) throw new Error("Não foi possível atualizar os dados essenciais do portal.");
    if (skipIfUnsaved && hasUnsavedFormChanges) return false;

    state.classes = (classesData || [])
      .map((item) => ({ ...item, name: item.name || "" }))
      .filter((item) => item.name);
    state.subjects = (subjectsData || [])
      .map((item) => ({ ...item, name: item.name || "" }))
      .filter((item) => item.name);
    state.students = sortPeopleByName((studentsData || []).map(normalizeStudentData));
    state.teachers = sortPeopleByName((teachersData || []).map(normalizeTeacherData));
    state.staff = sortPeopleByName(staffData || []);
    state.notifications = notificationsData || [];
    state.notificationDismissals = notificationDismissalsData || [];
    state.workTasks = workTasksData || [];
    state.workTaskAssignees = workTaskAssigneesData || [];
    state.sectorChecklists = sectorChecklistsData || [];
    state.sectorChecklistItems = sectorChecklistItemsData || [];
    state.sectorChecklistCompletions = sectorChecklistCompletionsData || [];
    state.sectorChecklistAssignees = sectorChecklistAssigneesData || [];
    state.sectorRecords = sectorRecordsData || [];
    state.kitchenMenu = kitchenMenuData || [];
    state.kitchenStock = kitchenStockData || [];
    state.dietaryRestrictions = dietaryRestrictionsData || [];
    state.supportRequests = supportRequestsData || [];
    state.studentDocuments = studentDocumentsData || [];
    state.teacherAssignments = (teacherAssignmentsData || []).map(normalizeTeacherAssignmentData);
    state.grades = (gradesData || []).map(normalizeGradeData);
    state.news = newsData || [];
    state.events = eventsData || [];
    state.activities = activitiesData || [];
    state.achievements = achievementsData || [];
    const config = configData?.[0];
    if (config) {
      state.schoolConfigId = config.id ?? null;
      state.about.history = !config.history || config.history === LEGACY_SCHOOL_HISTORY
        ? DEFAULT_SCHOOL_HISTORY
        : config.history;
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
    clearDatabaseLoadError();
    return true;
  } catch (error) {
    console.error("Erro ao carregar dados do Supabase:", error);
    showDatabaseLoadError();
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
    if (!optional) {
      requiredDataLoadErrors += 1;
      console.error(`Erro ao buscar ${table}:`, error);
    }
    throw error;
  }
}

function normalizeStudentData(student = {}) {
  return {
    ...student,
    className: student.className || student.classname || "",
    user: student.user || "",
    password: student.password || "",
    isJournalist: Boolean(student.is_journalist ?? student.isJournalist),
    isGraduated: Boolean(student.is_graduated ?? student.isGraduated),
    graduationClassName: student.graduation_classname || student.graduationClassName || "",
    graduationDate: student.graduation_date || student.graduationDate || ""
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
    const { id, ...dataWithoutId } = gradePayload;
    const request = id != null && id !== ""
      ? supabase.from("grades").update(dataWithoutId).eq("id", id)
      : supabase.from("grades").insert([dataWithoutId]);
    const { error } = await request;
    
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

  // Inserções podem ser enviadas em uma única requisição. As atualizações têm
  // valores diferentes por aluno, mas são executadas em paralelo para que uma
  // turma inteira não aguarde uma nota de cada vez.
  const newRecords = gradePayloads.filter((payload) => payload.id == null || payload.id === "");
  const existingRecords = gradePayloads.filter((payload) => payload.id != null && payload.id !== "");
  const saved = [];
  if (newRecords.length) {
    const records = newRecords.map(({ id, ...record }) => record);
    const { data, error } = await supabase.from("grades").insert(records).select();
    if (error) throw error;
    saved.push(...(data || []));
  }
  const updated = await Promise.all(existingRecords.map(async (payload) => {
    const { id, ...dataWithoutId } = payload;
    const { data, error } = await supabase.from("grades").update(dataWithoutId).eq("id", id).select();
    if (error) throw error;
    return data || [];
  }));
  updated.forEach((records) => saved.push(...records));
  clearCache("grades");
  return saved.map(normalizeGradeData);
}

function areTrimestersEqual(left, right) {
  const a = normalizeTrimester(left);
  const b = normalizeTrimester(right);
  return ["n1", "n2", "n3", "recoveryScore"].every((field) => parseGradeScore(a[field]) === parseGradeScore(b[field])) && Boolean(a.recovery) === Boolean(b.recovery);
}

function isValidGradeScore(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return true;
  if (!/^\d{1,2}(?:\.\d)?$/.test(normalized)) return false;
  const score = Number(normalized);
  return Number.isFinite(score) && score >= 0 && score <= 10;
}

// Professores costumam digitar notas no formato brasileiro (ex.: 7,5).
// Normalizamos antes de validar/calcular para que vírgula e ponto funcionem.
function parseGradeScore(value) {
  if (typeof value === "number") return value;
  const normalized = String(value ?? "").trim().replace(",", ".");
  const score = normalized === "" ? 0 : Number(normalized);
  // Nunca persiste pontuação fora da escala oficial 0,0–10,0.
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : 0;
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

function sameClassLabel(left, right) {
  return normalizeLabel(getClassLabel(left)) === normalizeLabel(getClassLabel(right));
}

function sameSubjectLabel(left, right) {
  return normalizeLabel(getSubjectLabel(left)) === normalizeLabel(getSubjectLabel(right));
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
  if (subjects.length === 1) return classes.map((className) => ({ subject: subjects[0], className }));
  if (classes.length === 1) return subjects.map((subject) => ({ subject, className: classes[0] }));
  return [];
}

function getValidClassesForTeacherSubject(teacher, subject) {
  const pairs = getTeacherSubjectClassPairs(teacher);
  const classes = pairs.filter((pair) => sameSubjectLabel(pair.subject, subject)).map((pair) => pair.className);
  return [...new Set(classes)];
}

function getValidSubjectsForTeacherClass(teacher, className) {
  const pairs = getTeacherSubjectClassPairs(teacher);
  const subjects = pairs.filter((pair) => sameClassLabel(pair.className, className)).map((pair) => pair.subject);
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

function hasLaunchedScore(grade, trimester, field) {
  return Number(getTrimester(grade, trimester)[field]) > 0;
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

function showDatabaseLoadError() {
  const region = $("[data-toast-region]");
  if (!region || $("#database-load-error")) return;
  const item = document.createElement("div");
  item.id = "database-load-error";
  item.className = "toast toast-error";
  item.setAttribute("role", "alert");
  item.textContent = "Não foi possível carregar os dados do banco. Esta tentativa não apagou os registros. Verifique a conexão e o projeto Supabase configurado.";
  region.append(item);
}

function clearDatabaseLoadError() {
  $("#database-load-error")?.remove();
}

function card(item, type, options = {}) {
  const title = item.title || item.name;
  const text = item.summary || item.description || item.content;
  const category = item.category || item.responsible || type;
  const media = item.files?.find((file) => file.type?.startsWith("image/") || file.type?.startsWith("video/"));
  const mediaMarkup = media?.type?.startsWith("image/")
    ? `<img class="card-media" src="${media.data}" alt="" loading="lazy" decoding="async">`
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

function currentPageName() {
  return (location.hash || "#inicio").replace("#", "").split("?")[0] || "inicio";
}

function renderVisiblePublicPage() {
  const page = currentPageName();
  if (page === "inicio") return renderHome();
  if (page === "noticias") return renderNews();
  if (page === "noticia") return renderNewsDetail();
  if (page === "quem-somos") return renderAbout();
  if (page === "calendario") return renderCalendar();
  if (page === "atividades") return renderActivities();
  if (page === "conquistas") return renderAchievements();
  if (page === "contato") return renderContact();
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
  const image = item.files?.find((file) => file.type?.startsWith("image/"));
  const attachments = (item.files || []).filter((file) => !file.type?.startsWith("image/"));
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

function readFileAsDataUrl(file) {
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
  // Mantém o acesso em recargas e depois do fechamento acidental da aba.
  const stored = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.removeItem(SESSION_KEY);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
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
    if (teachers?.length) {
      const teacher = normalizeTeacherData(teachers[0]);
      state.teachers = sortPeopleByName([
        ...state.teachers.filter((item) => !idsEqual(item.id, teacher.id)),
        teacher
      ]);
      clearCache("teachers");
      return { role: "teacher", id: teacher.id, name: teacher.name };
    }

    const { data: staff } = await supabase
      .from("staff")
      .select("*")
      .ilike("user", username)
      .eq("password", secret);
    if (staff?.length) return { role: "staff", id: staff[0].id, name: staff[0].name, sector: staff[0].sector };

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
    if (session?.role === "staff") {
      renderStaffPanel(session);
      return;
    }
    if (session?.role === "student") {
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
  const teacher = state.teachers.find((item) => idsEqual(item.id, session.id));
  if (!teacher) {
    clearSession();
    renderLoginForm();
    return;
  }
  const teacherClasses = getTeacherClasses(teacher);
  const teacherSubjects = getTeacherSubjects(teacher);
  const hasAmbiguousLegacyAssignments = !getTeacherAssignments(teacher).length && teacherClasses.length > 1 && teacherSubjects.length > 1;
  if (!teacherSubjects.length && teacher.subject) teacherSubjects.push(...parseTeacherSubjectList(teacher.subject));
  if (!teacherClasses.some((className) => normalizeLabel(className) === normalizeLabel(currentTeacherClass))) currentTeacherClass = "";
  const subjectsForSelectedClass = currentTeacherClass ? getValidSubjectsForTeacherClass(teacher, currentTeacherClass) : [];
  if (!subjectsForSelectedClass.some((subject) => normalizeLabel(subject) === normalizeLabel(currentTeacherSubject))) currentTeacherSubject = "";

  const activeSubject = currentTeacherSubject;
  const activeClass = currentTeacherClass;
  const teacherStudents = activeClass && activeSubject
    ? sortPeopleByName(state.students.filter((student) => sameClassLabel(student.className, activeClass)))
    : [];
  const teacherGrades = state.grades.filter(
    (grade) =>
      sameSubjectLabel(grade.subject, activeSubject) &&
      sameClassLabel(grade.className, activeClass)
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
        ${notificationBell(session)}
        ${passwordChangeButton(session)}
        ${secretaryChatButton(session)}
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
      ${hasAmbiguousLegacyAssignments ? `<p class="badge warning" role="status">Os vínculos antigos não informam qual disciplina pertence a cada turma. Peça à direção para revisar as disciplinas e turmas deste professor.</p>` : ""}
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
    <section class="panel">
      <h3>Enviar arquivo para impressão</h3>
      <form class="contact-form" data-print-request-form>
        <label>Orientação para a Secretaria<input class="input" name="details" placeholder="Ex.: 20 cópias, frente e verso"></label>
        <label>Arquivo<input class="input" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*" required></label>
        <button class="button primary">Enviar para impressão</button>
      </form>
    </section>
  `;

  root.insertAdjacentHTML("beforeend", renderSectorChecklists(session));
  bindSectorChecklists(session);
  bindSecretaryChat(session);
  bindPasswordChange(session);
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
    generatePdfReport(
      `Relatório de notas - ${activeSubject} - ${activeClass}`,
      teacherPdfReportTable(teacherGrades, activeSubject, activeClass),
      { landscape: true, officialSheet: true, className: activeClass, subject: activeSubject, teacherName: teacher.name }
    );
  });

  $("[data-print-request-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const file = form.get("file");
    if (!file?.size) return toast("Selecione o arquivo para impressão.");
    try {
      const [attachment] = await readAttachments([file]);
      const saved = await startSupportConversation({
        requesterId: String(session.id),
        requesterName: teacher.name,
        requesterRole: "teacher",
        subject: "Pedido de impressão",
        body: String(form.get("details") || "Arquivo enviado para impressão."),
        attachment
      });
      if (saved) event.target.reset();
    } catch (error) {
      console.error("Erro ao enviar arquivo para impressão:", error);
      toast(error.message || "Não foi possível enviar o arquivo para impressão.");
    }
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
          sameSubjectLabel(g.subject, activeSubject) &&
          sameClassLabel(g.className, activeClass)
      );

      const n1 = event.target.elements[`n1-${student.id}`]?.value || 0;
      const n2 = event.target.elements[`n2-${student.id}`]?.value || 0;
      const n3 = event.target.elements[`n3-${student.id}`]?.value || 0;
      const recoveryScore = event.target.elements[`rec-${student.id}`]?.value || 0;
      if (![n1, n2, n3, recoveryScore].every(isValidGradeScore)) {
        return toast(`A nota de ${student.name} deve estar entre 0,0 e 10,0, com uma casa decimal.`);
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
        studentId: student.id,
        subject: activeSubject,
        className: getClassLabel(activeClass),
        trimesters: { 1: normalizeTrimester(), 2: normalizeTrimester(), 3: normalizeTrimester() }
      };

      gradeData.trimesters[currentTeacherTrimester] = { n1, n2, n3, recovery, recoveryScore };
      if (!existing || !areTrimestersEqual(existing.trimesters?.[currentTeacherTrimester], gradeData.trimesters[currentTeacherTrimester])) {
        gradeUpdates.push({ existing, gradeData });
      }
    }

    if (!gradeUpdates.length) return toast("Nenhuma nota foi alterada.");

    const submitButton = event.target.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Salvando...";
    }
    try {
      const savedGrades = await saveGradesToSupabase(gradeUpdates.map((item) => item.gradeData));
      gradeUpdates.forEach(({ existing, gradeData }) => {
        const savedGrade = savedGrades.find((item) =>
          (gradeData.id && idsEqual(item.id, gradeData.id)) ||
          (!gradeData.id &&
            idsEqual(item.studentId, gradeData.studentId) &&
            sameSubjectLabel(item.subject, gradeData.subject) &&
            sameClassLabel(item.className, gradeData.className))
        ) || gradeData;
        if (existing) {
          const index = state.grades.indexOf(existing);
          if (index >= 0) state.grades[index] = savedGrade;
        } else {
          state.grades.push(savedGrade);
        }
      });
      try {
        const { data: notices, error: noticeError } = await supabase.from("private_notifications").insert(
          gradeUpdates.map(({ gradeData }) => ({
            title: "Notas atualizadas",
            message: `Foram lançadas ou atualizadas notas de ${getSubjectLabel(gradeData.subject)} no ${currentTeacherTrimester}º trimestre.`,
            recipient_student_id: gradeData.studentId
          }))
        ).select();
        if (noticeError) throw noticeError;
        state.notifications.push(...(notices || []));
        clearCache("private_notifications");
      } catch (noticeError) {
        console.warn("Notas salvas, mas não foi possível criar a notificação:", noticeError);
      }
      // Recarrega do banco para garantir que a tela mostre exatamente os dados
      // persistidos, inclusive depois de uma alteração em uma nota já lançada.
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
  return state.teachers.filter((teacher) =>
    getTeacherSubjectClassPairs(teacher).some(
      (pair) => sameSubjectLabel(pair.subject, subject) && sameClassLabel(pair.className, className)
    )
  );
}

function getStudentSubjectEntries(student) {
  const className = getClassLabel(student.className);
  const subjects = new Set(getSubjectsForClass(className));
  state.grades
    .filter((grade) => idsEqual(grade.studentId, student.id) && sameClassLabel(grade.className, className))
    .forEach((grade) => subjects.add(getSubjectLabel(grade.subject)));

  return [...subjects]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .map((subject) => ({
      subject,
      grade: state.grades.find(
        (grade) => idsEqual(grade.studentId, student.id) &&
          sameSubjectLabel(grade.subject, subject) &&
          sameClassLabel(grade.className, className)
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
        ${notificationBell(session)}
        ${secretaryChatButton(session)}
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

  root.insertAdjacentHTML("beforeend", renderSectorChecklists(session));
  bindSectorChecklists(session);
  $("[data-logout]").addEventListener("click", () => {
    clearSession();
    renderLoginPortal();
  });

  bindSecretaryChat(session);
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
    generatePdfReport(
      `Boletim escolar - ${student.name}`,
      studentPdfReportTable(subjectEntries, allGradesComplete, finalRecovery),
      { landscape: true, studentName: student.name, className: getClassLabel(student.className) }
    );
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
      <div class="row-actions"><button class="button ghost" type="button" data-student-bulletin>Meu boletim</button>${notificationBell(session)}<button class="button ghost" type="button" data-logout>Sair</button></div>
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
    const saved = await upsertRecord("news", payload, "id", id ? "Matéria atualizada e enviada para revisão." : "Matéria enviada para revisão.", { skipPortalRender: true });
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
  const scoreCell = (grade, trimester, field) => {
    const value = Number(getTrimester(grade, trimester)[field] || 0);
    const scoreWasLaunched = hasLaunchedScore(grade, trimester, field);
    return `<td class="${scoreWasLaunched && value < 6 ? "score-low" : ""}">${value.toFixed(1)}</td>`;
  };
  const averageCell = (value, hasLaunchedScore) => `<td class="score-average ${hasLaunchedScore && Number(value) < 6 ? "score-low" : ""}">${value}</td>`;
  const rows = subjectEntries
    .map(({ subject, grade, teachers }) => {
      const gradeData = grade || { trimesters: {} };
      const approved = Number(gradeAverage(gradeData)) >= 6;
      const teacherNames = teachers.map((teacher) => teacher.name).filter(Boolean).join(", ");
      const trimesterCells = ["1", "2", "3"]
        .map((trimester) => `${scoreCell(gradeData, trimester, "n1")}${scoreCell(gradeData, trimester, "n2")}${scoreCell(gradeData, trimester, "n3")}${averageCell(getTrimesterFinalAverage(gradeData, trimester), hasTrimesterScores(gradeData, trimester))}`)
        .join("");
      return `
        <tr>
          <td>${escapeHtml(subject)}</td>
          <td>${escapeHtml(teacherNames || "Não vinculado")}</td>
          ${trimesterCells}
          ${averageCell(gradeAverage(gradeData), ["1", "2", "3"].some((trimester) => hasTrimesterScores(gradeData, trimester)))}
          <td>${grade ? (allComplete ? (approved ? "Aprovado" : finalRecovery ? "Recuperação final" : "Recuperação") : "Pendente") : "Sem notas"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-scroll">
      <table class="report-table student-detailed-report">
        <thead>
          <tr><th rowspan="2">Disciplina</th><th rowspan="2">Professor(a)</th><th colspan="4">1º trimestre</th><th colspan="4">2º trimestre</th><th colspan="4">3º trimestre</th><th rowspan="2">Média anual</th><th rowspan="2">Situação</th></tr>
          <tr>${["1", "2", "3"].map(() => "<th>Nota 1</th><th>Nota 2</th><th>Nota 3</th><th>Média</th>").join("")}</tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="16">Nenhuma disciplina vinculada à turma.</td></tr>`}</tbody>
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

function generatePdfReport(title, content, options = {}) {
  // A abertura ocorre durante o clique do usuário. Não use `noopener`, pois
  // alguns navegadores retornam `null` e impedem a criação do relatório.
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    toast("Permita pop-ups para gerar o PDF.");
    return;
  }
  const logoUrl = new URL(SCHOOL_LOGO, window.location.href).href;
  const stateLogoUrl = new URL("brasao-piaui.webp", window.location.href).href;
  const pageOrientation = options.landscape ? "landscape" : "portrait";
  const generatedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date());
  reportWindow.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 ${pageOrientation}; margin: 12mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
          .pdf-header {
            display: grid;
            grid-template-columns: 82px 1fr 82px;
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
          .state-logo { width: 72px; height: 72px; object-fit: contain; }
          .pdf-header-copy { text-align: center; }
          .school-name {
            font-size: 19px;
            font-weight: 800;
            text-transform: uppercase;
            color: #253a9b;
            margin: 0 0 4px;
          }
          .report-label { font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #13235f; margin: 0 0 5px; }
          .school-info {
            display: grid;
            gap: 2px;
            color: #4b5563;
            font-size: 12px;
            margin: 0;
          }
          h1 { font-size: 19px; text-transform: uppercase; text-align: center; margin: 0 0 12px; }
          p { margin: 0; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #334155; padding: 6px; text-align: center; vertical-align: middle; }
          th { background: #e8eefc; color: #13235f; font-weight: 800; }
          .student-name, .student-sheet td:first-child { text-align: left; }
          .average { font-weight: 800; }
          .low-score { color: #b91c1c; font-weight: 800; }
          .table-scroll { overflow: visible; }
          .report-meta { margin-bottom: 12px; font-size: 11px; text-align: center; }
          .report-context { border: 1px solid #334155; padding: 8px 10px; display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; }
          .legend { font-size: 9px; margin-top: 8px; }
          .grade-sheet { font-size: 8px; }
          .grade-sheet th, .grade-sheet td { padding: 4px 3px; }
          .grade-sheet .student-name { min-width: 125px; }
          .student-sheet { font-size: 8px; table-layout: fixed; }
          .student-sheet th:first-child { width: 135px; }
          .actions { display: flex; gap: 8px; margin-top: 18px; }
          button { border: 1px solid #253a9b; background: #253a9b; color: white; padding: 10px 14px; font-weight: 700; cursor: pointer; }
          @media print { .actions { display: none; } }
        </style>
      </head>
      <body>
        <header class="pdf-header">
          <img class="state-logo" src="${stateLogoUrl}" alt="Brasão do Estado do Piauí">
          <div class="pdf-header-copy">
            <p class="school-name">CETI Maria Neusa de Sousa</p>
            <p class="report-label">Ficha de rendimento</p>
            <p class="school-info">
              <span>Centro Estadual de Tempo Integral</span>
              <span>${escapeHtml(state.contact.address)}</span>
              <span>Telefone: ${escapeHtml(state.contact.phone)} | E-mail: ${escapeHtml(state.contact.email)}</span>
            </p>
          </div>
          <img class="pdf-logo" src="${logoUrl}" alt="Logo do CETI Maria Neusa de Sousa">
        </header>
        <h1>${escapeHtml(title)}</h1>
        ${options.officialSheet ? `<div class="report-context"><span><strong>Turma:</strong> ${escapeHtml(getClassLabel(options.className || ""))}</span><span><strong>Disciplina:</strong> ${escapeHtml(getSubjectLabel(options.subject || ""))}</span><span><strong>Professor(a):</strong> ${escapeHtml(options.teacherName || "Não informado")}</span></div>` : ""}
        ${options.studentName ? `<div class="report-context"><span><strong>Estudante:</strong> ${escapeHtml(options.studentName)}</span><span><strong>Turma:</strong> ${escapeHtml(options.className || "Não informada")}</span></div>` : ""}
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
const sectorLabels = { secretaria: "Secretaria Escolar", cozinha: "Cozinha / Merenda", servicos_gerais: "Serviços Gerais e Manutenção", professores: "Professores", alunos: "Alunos" };
const sectorModules = {
  secretaria: ["Documentos", "Matrículas e rematrículas", "Frequência e turmas", "Arquivo do aluno"],
  cozinha: ["Cardápio nutricional", "Estoque da despensa", "Validade e estoque mínimo", "Solicitação de insumos", "Restrições alimentares"],
  servicos_gerais: ["Chamados de manutenção", "Cronograma de limpeza", "Produtos e EPIs", "Checklist diário"]
};

function checklistSectorFor(session) {
  if (session.role === "teacher") return "professores";
  if (session.role === "student") return "alunos";
  return session.sector || "";
}

function renderSectorChecklists(session) {
  const sector = checklistSectorFor(session);
  const weekday = new Date().getDay();
  const checklists = state.sectorChecklists.filter((item) => {
    const days = Array.isArray(item.weekdays) ? item.weekdays : [0, 1, 2, 3, 4, 5, 6];
    const assigned = state.sectorChecklistAssignees.filter((assignment) => idsEqual(assignment.checklist_id, item.id));
    return item.active !== false && item.sector === sector && days.includes(weekday) && (!assigned.length || assigned.some((assignment) => idsEqual(assignment.user_id, session.id) && assignment.user_role === session.role));
  });
  if (!checklists.length) return "";
  return `<section class="panel sector-checklist"><div class="portal-heading compact"><div><span class="checklist-eyebrow">ROTINA INTELIGENTE</span><h3>Checklist do setor</h3><p class="muted">Marque os itens realizados. O andamento fica visível para a direção.</p></div></div>${checklists.map((checklist) => {
    const items = state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, checklist.id)).sort((a, b) => Number(a.position) - Number(b.position));
    const completedOn = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const completed = new Set(state.sectorChecklistCompletions.filter((item) => idsEqual(item.checklist_id, checklist.id) && idsEqual(item.user_id, session.id) && item.user_role === session.role && item.completed && item.completed_on === completedOn).map((item) => String(item.item_id)));
    if (items.length && completed.size === items.length) return "";
    const percent = items.length ? Math.round((completed.size / items.length) * 100) : 0;
    return `<article class="checklist-card"><div class="checklist-card-head"><div><span class="checklist-icon">✓</span><strong>${escapeHtml(checklist.title)}</strong><p class="muted">${escapeHtml(checklist.location || sectorLabels[checklist.sector] || checklist.sector)}${checklist.description ? ` · ${escapeHtml(checklist.description)}` : ""}</p></div><div class="checklist-progress"><strong>${percent}%</strong><span>${completed.size} de ${items.length} concluídos</span></div></div><div class="checklist-meter" aria-label="${percent}% concluído"><i style="width:${percent}%"></i></div><div class="checklist-items">${items.map((item, index) => `<label class="checklist-item ${completed.has(String(item.id)) ? "is-done" : ""}"><input type="checkbox" data-checklist-item="${escapeHtml(item.id)}" data-checklist-id="${escapeHtml(checklist.id)}" ${completed.has(String(item.id)) ? "checked" : ""}><span class="checklist-check">✓</span><span class="checklist-item-number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(item.label)}</span><em>${completed.has(String(item.id)) ? "Concluído" : "Toque para concluir"}</em></label>`).join("") || `<p class="muted">Este checklist ainda não possui itens.</p>`}</div></article>`;
  }).join("")}</section>`;
}

function bindSectorChecklists(session) {
  $$('[data-checklist-item]').forEach((input) => input.addEventListener("change", async () => {
    const completedOn = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const existing = state.sectorChecklistCompletions.find((item) => idsEqual(item.item_id, input.dataset.checklistItem) && idsEqual(item.checklist_id, input.dataset.checklistId) && idsEqual(item.user_id, session.id) && item.user_role === session.role && item.completed_on === completedOn);
    const payload = { checklist_id: input.dataset.checklistId, item_id: input.dataset.checklistItem, user_id: String(session.id), user_role: session.role, completed: input.checked, completed_at: input.checked ? new Date().toISOString() : null, completed_on: completedOn };
    const { data, error } = existing ? await supabase.from("sector_checklist_completions").update(payload).eq("id", existing.id).select().single() : await supabase.from("sector_checklist_completions").insert(payload).select().single();
    if (error) { console.error("Erro ao salvar checklist:", error); input.checked = !input.checked; return toast("Não foi possível atualizar o checklist."); }
    if (existing) Object.assign(existing, data); else state.sectorChecklistCompletions.push(data);
    const total = state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, input.dataset.checklistId)).length;
    const done = state.sectorChecklistCompletions.filter((item) => idsEqual(item.checklist_id, input.dataset.checklistId) && idsEqual(item.user_id, session.id) && item.user_role === session.role && item.completed && item.completed_on === completedOn).length;
    clearCache("sector_checklist_completions");
    if (total && done === total) toast("Checklist concluído com sucesso. Até amanhã!");
    renderLoginPortal();
  }));
}

function privateNotificationsFor(session) {
  const audience = session.role === "student" ? "all_students" : session.role === "teacher" ? "all_teachers" : session.role === "staff" ? "all_staff" : "all_admins";
  const localDismissals = new Set(JSON.parse(localStorage.getItem(`ceti-dismissed-${session.role}-${session.id}`) || "[]"));
  const dismissedIds = new Set(
    state.notificationDismissals
      .filter((item) => idsEqual(item.user_id, session.id) && item.user_role === session.role)
      .map((item) => String(item.notification_id))
  );
  return state.notifications.filter((item) =>
    !dismissedIds.has(String(item.id)) && !localDismissals.has(String(item.id)) &&
    (item.recipient_id === session.id || item.recipient_student_id === session.id || item.recipient_role === audience || item.recipient_role === "all_school" || (session.role === "staff" && item.recipient_sector === session.sector))
  );
}

async function syncLocalNotificationDismissals(session) {
  const syncKey = `${session.role}:${session.id}`;
  if (notificationDismissalSyncAttempts.has(syncKey)) return;
  const storageKey = `ceti-dismissed-${session.role}-${session.id}`;
  let dismissedIds;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      notificationDismissalSyncAttempts.add(syncKey);
      return;
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Formato local de avisos ocultados inválido.");
    dismissedIds = [...new Set(parsed.map(String))];
  } catch (error) {
    notificationDismissalSyncAttempts.add(syncKey);
    console.error("Não foi possível ler avisos ocultados neste dispositivo:", error);
    return;
  }

  const availableNotificationIds = new Set(state.notifications.map((item) => String(item.id)));
  const rows = dismissedIds
    .filter((id) => availableNotificationIds.has(id))
    .map((notificationId) => ({
      notification_id: notificationId,
      user_id: String(session.id),
      user_role: session.role
    }));
  if (!rows.length) return;
  notificationDismissalSyncAttempts.add(syncKey);

  let result;
  try {
    result = await supabase
      .from("notification_dismissals")
      .upsert(rows, { onConflict: "notification_id,user_id,user_role" })
      .select();
  } catch (error) {
    console.error("Não foi possível sincronizar avisos ocultados:", error);
    return;
  }
  const { data, error } = result;
  if (error) {
    console.error("Não foi possível sincronizar avisos ocultados:", error);
    return;
  }

  const savedRows = data || rows;
  const existingKeys = new Set(state.notificationDismissals.map((item) =>
    `${item.notification_id}:${item.user_id}:${item.user_role}`
  ));
  state.notificationDismissals = [
    ...state.notificationDismissals,
    ...savedRows.filter((item) => !existingKeys.has(`${item.notification_id}:${item.user_id}:${item.user_role}`))
  ];
  clearCache("notification_dismissals");
  try {
    localStorage.removeItem(storageKey);
  } catch (storageError) {
    console.warn("Avisos sincronizados, mas a cópia local não pôde ser removida.", storageError);
  }
}

function notificationBell(session) {
  void syncLocalNotificationDismissals(session);
  const count = privateNotificationsFor(session).length;
  return `<button class="button ghost notification-bell" type="button" data-notification-bell aria-label="Abrir avisos">&#128276;${count ? `<span class="notification-count">${count}</span>` : ""}</button>`;
}

function openNotificationPanel() {
  const session = getSession();
  if (!session) return;
  const notes = privateNotificationsFor(session).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const root = $("[data-login-root]");
  const old = $("[data-notification-panel]", root);
  if (old) return old.remove();
  root.insertAdjacentHTML("afterbegin", `<section class="panel notification-panel" data-notification-panel><div class="portal-heading compact"><div><h2>🔔 Avisos</h2><p class="muted">Mensagens direcionadas ao seu painel.</p></div><div class="row-actions">${notes.length ? '<button class="button ghost" type="button" data-notification-clear>Limpar meus avisos</button>' : ""}<button class="button ghost" type="button" data-notification-close>Fechar</button></div></div><div class="list-view">${notes.map((note) => `<article class="list-item"><div><strong>${escapeHtml(note.title)}</strong><p class="muted">${escapeHtml(note.message)}</p></div></article>`).join("") || emptyState("Você não possui avisos no momento.")}</div></section>`);
  $("[data-notification-close]", root).addEventListener("click", () => $("[data-notification-panel]", root)?.remove());
  $("[data-notification-clear]", root)?.addEventListener("click", () => clearMyNotifications(session, notes));
}

async function clearMyNotifications(session, notes) {
  const dismissals = notes.map((note) => ({ notification_id: note.id, user_id: String(session.id), user_role: session.role }));
  const { data, error } = await supabase.from("notification_dismissals").upsert(dismissals, { onConflict: "notification_id,user_id,user_role" }).select();
  if (error) {
    console.error("Erro ao limpar avisos:", error);
    localStorage.setItem(`ceti-dismissed-${session.role}-${session.id}`, JSON.stringify(notes.map((note) => String(note.id))));
    $("[data-notification-panel]")?.remove();
    toast("Avisos ocultados neste dispositivo. Execute a migração para sincronizar em todos os acessos.");
    renderLoginPortal();
    return;
  }
  state.notificationDismissals = [...state.notificationDismissals, ...(data || [])];
  clearCache("notification_dismissals");
  $("[data-notification-panel]")?.remove();
  toast("Seus avisos foram limpos.");
  renderLoginPortal();
}

function passwordChangeButton(session) {
  return session?.role !== "student" ? '<button class="button ghost" type="button" data-password-change>Criar/alterar senha</button>' : "";
}

function bindPasswordChange(session) {
  $("[data-password-change]")?.addEventListener("click", () => renderWorkforcePasswordChange(session));
}

function renderWorkforcePasswordChange(session) {
  const table = session.role === "admin" ? "admins" : session.role === "teacher" ? "teachers" : "staff";
  const root = $("[data-login-root]");
  root.innerHTML = `<form class="panel contact-form login-card" data-workforce-password-form><h2>Crie sua senha</h2><p class="muted">Escolha uma senha pessoal para acessar seu portal.</p><label>Nova senha<input class="input" name="password" type="password" minlength="4" required autocomplete="new-password"></label><label>Confirmar nova senha<input class="input" name="confirmation" type="password" minlength="4" required autocomplete="new-password"></label><button class="button primary" type="submit">Salvar senha</button><button class="button ghost" type="button" data-password-cancel>Cancelar</button></form>`;
  $("[data-workforce-password-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const password = normalizePassword(form.get("password"));
    if (password !== normalizePassword(form.get("confirmation"))) return toast("As senhas não conferem.");
    const { error } = await supabase.from(table).update({ password }).eq("id", session.id);
    if (error) return toast("Não foi possível salvar a senha. Tente novamente.");
    clearCache(table);
    toast("Senha salva com sucesso.");
    renderLoginPortal();
  });
  $("[data-password-cancel]").addEventListener("click", () => renderLoginPortal());
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-notification-bell]")) openNotificationPanel();
});

function secretaryChatButton(session) {
  if (!session || !["student", "teacher"].includes(session.role)) return "";
  return `<button class="secretary-chat-button" type="button" data-secretary-chat title="Falar com a Secretaria" aria-label="Falar com a Secretaria">${secretaryChatIcon()}</button>`;
}

function secretaryChatIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke="currentColor" stroke-linecap="round" stroke-width="2.5"/></svg>`;
}

function supportMessagesFor(requestId) {
  return state.supportMessages
    .filter((message) => idsEqual(message.support_request_id, requestId))
    .sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
}

async function ensureSupportMessagesLoaded(requestId = null) {
  const requestKey = requestId === null ? null : String(requestId);
  if (supportMessagesLoaded || (requestKey && loadedSupportMessageRequestIds.has(requestKey))) return;
  const loadKey = requestKey || "*";
  if (!supportMessagesLoadPromises.has(loadKey)) {
    let query = supabase.from("support_messages").select("*").order("created_at", { ascending: true });
    if (requestKey) query = query.eq("support_request_id", requestKey);
    supportMessagesLoadPromises.set(loadKey, query);
  }
  const loadPromise = supportMessagesLoadPromises.get(loadKey);
  try {
    const { data, error } = await loadPromise;
    if (error) throw error;
    if (requestKey) {
      const loadedMessages = data || [];
      const loadedMessageIds = new Set(loadedMessages.map((message) => String(message.id)));
      const otherMessages = state.supportMessages.filter((message) => !idsEqual(message.support_request_id, requestKey));
      const pendingLocalMessages = state.supportMessages.filter((message) =>
        idsEqual(message.support_request_id, requestKey) && !loadedMessageIds.has(String(message.id))
      );
      state.supportMessages = [...otherMessages, ...loadedMessages, ...pendingLocalMessages];
      loadedSupportMessageRequestIds.add(requestKey);
    } else {
      state.supportMessages = data || [];
      supportMessagesLoaded = true;
    }
  } finally {
    if (supportMessagesLoadPromises.get(loadKey) === loadPromise) supportMessagesLoadPromises.delete(loadKey);
  }
}

function latestSupportRequest(requesterId) {
  return state.supportRequests
    .filter((request) => idsEqual(request.requester_id, requesterId))
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

function activeSupportRequest(requesterId) {
  return state.supportRequests
    .filter((request) => idsEqual(request.requester_id, requesterId) && String(request.status || "").toLowerCase() !== "encerrado")
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

function dateKeyForDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function schoolDateKey(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dateRangeForPeriod(period, dateValue) {
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(dateValue || "") ? new Date(`${dateValue}T12:00:00`) : new Date();
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  const end = new Date(start);
  if (period === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else if (period === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  } else if (period === "year") {
    start.setMonth(0, 1);
    end.setFullYear(start.getFullYear(), 11, 31);
  }
  return { start: dateKeyForDate(start), end: dateKeyForDate(end) };
}

function supportAttachmentLink(file) {
  if (!file?.data) return "";
  return `<a class="support-attachment" href="${escapeHtml(file.data)}" download="${escapeHtml(file.name || "documento")}">Baixar ${escapeHtml(file.name || "documento")}</a>`;
}

function supportMessageList(request, viewerRole) {
  let messages = supportMessagesFor(request.id);
  if (!messages.length) {
    messages = [{ sender_role: request.requester_role || "public", sender_name: request.requester_name, body: request.message, attachment: request.attachment, created_at: request.created_at }];
    if (request.reply) messages.push({ sender_role: "secretaria", sender_name: "Secretaria", body: request.reply });
  }
  return `<div class="support-message-list">${messages.map((message) => {
    const own = viewerRole === "secretaria" ? message.sender_role === "secretaria" : message.sender_role !== "secretaria" && message.sender_role !== "assistant";
    const sender = message.sender_role === "assistant" ? "Assistente virtual" : message.sender_name || (message.sender_role === "secretaria" ? "Secretaria" : request.requester_name);
    return `<article class="support-message ${own ? "own" : ""} ${message.sender_role === "assistant" ? "automated" : ""}"><strong>${escapeHtml(sender)}</strong><p>${escapeHtml(message.body || "")}</p>${supportAttachmentLink(message.attachment)}<time>${message.created_at ? escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(message.created_at))) : ""}</time></article>`;
  }).join("")}</div>`;
}

function greetingResponse(message, firstMessage) {
  const normalized = normalizeLabel(message).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isGreeting = /^(oi|ola|bom dia|boa tarde|boa noite|ol[aá]|oi,? tudo bem)[!.?\s]*$/.test(normalized);
  if (isGreeting) return "Olá! Estes são alguns serviços da Secretaria: declarações, diplomas e históricos, matrículas e rematrículas, frequência e turmas, e outros atendimentos. Em breve nossa equipe vai lhe responder.";
  return firstMessage ? "Recebemos sua mensagem. Em breve nossa equipe vai lhe responder." : "";
}

async function insertSupportRequest(payload) {
  const { data, error } = await supabase.from("support_requests").insert(payload).select().single();
  if (error) {
    console.error("Erro ao abrir atendimento:", error);
    toast(`Não foi possível abrir o atendimento: ${error.message || "tente novamente."}`);
    return false;
  }
  state.supportRequests.push(data);
  clearCache("support_requests");
  return data;
}

async function insertSupportMessage(request, message, sender) {
  const payload = {
    support_request_id: request.id,
    sender_role: sender.role,
    sender_id: sender.id || null,
    sender_name: sender.name,
    body: message.body,
    attachment: message.attachment || null
  };
  const { data, error } = await supabase.from("support_messages").insert(payload).select().single();
  if (error) {
    console.error("Erro ao enviar mensagem do atendimento:", error);
    toast(`Não foi possível enviar a mensagem: ${error.message || "tente novamente."}`);
    return false;
  }
  state.supportMessages.push(data);
  clearCache("support_messages");
  return data;
}

async function sendSupportMessage(request, message, sender, { firstMessage = false } = {}) {
  if (!firstMessage) {
    const { data: currentRequest, error: requestError } = await supabase
      .from("support_requests")
      .select("status")
      .eq("id", request.id)
      .maybeSingle();
    if (requestError) {
      console.error("Erro ao verificar o status do atendimento:", requestError);
      toast(`Não foi possível confirmar se o atendimento está aberto: ${requestError.message || "tente novamente."}`);
      return false;
    }
    if (!currentRequest) {
      toast("Este atendimento não foi encontrado. Atualize a página antes de enviar outra mensagem.");
      return false;
    }
    if (String(currentRequest.status || "").toLowerCase() === "encerrado") {
      Object.assign(request, currentRequest);
      toast("Este assunto já foi encerrado. Inicie uma nova conversa.");
      return false;
    }
  }

  const saved = await insertSupportMessage(request, message, sender);
  if (!saved) return false;

  const automaticReply = sender.role === "secretaria" ? "" : greetingResponse(message.body, firstMessage);
  if (automaticReply) {
    const automated = await insertSupportMessage(request, { body: automaticReply }, { role: "assistant", name: "Assistente virtual" });
    if (!automated) return false;
  }
  const status = sender.role === "secretaria" ? "Respondido" : "Aberto";
  const { data, error } = await supabase.from("support_requests").update({ status, closed_at: null }).eq("id", request.id).select().single();
  if (error) {
    console.error("Erro ao atualizar o atendimento:", error);
    toast(`A mensagem foi enviada, mas o status não foi atualizado: ${error.message || "tente novamente."}`);
  } else {
    Object.assign(request, data);
    clearCache("support_requests");
  }
  if (sender.role === "secretaria") {
    await upsertRecord("private_notifications", {
      title: "Resposta da Secretaria",
      message: message.body || "A Secretaria enviou um documento no atendimento.",
      recipient_id: request.requester_id
    }, "id", "", { skipPortalRender: true });
  }
  return true;
}

async function startSupportConversation({ requesterId, requesterName, requesterRole, contact = "", subject, body, attachment = null }) {
  const request = await insertSupportRequest({
    requester_id: requesterId,
    requester_name: requesterName,
    requester_role: requesterRole,
    requester_contact: contact || null,
    subject,
    message: body,
    attachment: null,
    status: "Aberto"
  });
  if (!request) return false;
  const sent = await sendSupportMessage(request, { body, attachment }, { role: requesterRole, id: requesterId, name: requesterName }, { firstMessage: true });
  if (!sent) return false;
  await upsertRecord("private_notifications", {
    title: "Novo atendimento",
    message: `${requesterName}: ${subject}`,
    recipient_sector: "secretaria"
  }, "id", "", { skipPortalRender: true });
  return request;
}

function supportComposer(request, viewerRole, requesterId, requesterName, requesterRole, contact = "") {
  const isNew = !request;
  return `<form class="support-composer" data-support-composer${request ? ` data-support-request="${escapeHtml(request.id)}"` : ""} data-support-role="${escapeHtml(viewerRole)}" data-requester-id="${escapeHtml(requesterId)}" data-requester-name="${escapeHtml(requesterName)}" data-requester-role="${escapeHtml(requesterRole)}" data-requester-contact="${escapeHtml(contact)}">
    ${isNew ? `<label>Assunto<select class="input" name="subject"><option>Dúvida</option><option>Declaração</option><option>Diploma ou histórico</option><option>Matrícula ou rematrícula</option><option>Pedido de impressão</option><option>Outro atendimento</option></select></label>` : ""}
    <label class="sr-only" for="support-message-${escapeHtml(request?.id || "new")}">Mensagem</label><textarea class="input" id="support-message-${escapeHtml(request?.id || "new")}" name="message" rows="2" placeholder="Digite sua mensagem..."></textarea>
    <label class="support-file-label">Anexar documento<input class="input" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"></label>
    <button class="button primary" type="submit">Enviar</button>
  </form>`;
}

function bindSupportComposer(root, afterSend = () => {}) {
  $$("[data-support-composer]", root).forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const body = String(values.get("message") || "").trim();
      const file = values.get("file");
      if (!body && !file?.size) return toast("Escreva uma mensagem ou selecione um documento.");
      const attachment = file?.size ? (await readAttachments([file]))[0] : null;
      const requestId = form.dataset.supportRequest;
      let saved;
      if (requestId) {
        const request = state.supportRequests.find((item) => idsEqual(item.id, requestId));
        if (!request) return toast("Este atendimento não foi encontrado. Atualize a página.");
        saved = await sendSupportMessage(request, { body, attachment }, {
          role: form.dataset.supportRole,
          id: form.dataset.requesterId,
          name: form.dataset.requesterName
        });
      } else {
        saved = await startSupportConversation({
          requesterId: form.dataset.requesterId,
          requesterName: form.dataset.requesterName,
          requesterRole: form.dataset.requesterRole,
          contact: form.dataset.requesterContact,
          subject: String(values.get("subject") || "Atendimento"),
          body,
          attachment
        });
      }
      if (saved) {
        hasUnsavedFormChanges = false;
        afterSend();
      } else if (requestId && String(state.supportRequests.find((item) => idsEqual(item.id, requestId))?.status || "").toLowerCase() === "encerrado") {
        hasUnsavedFormChanges = false;
        afterSend();
      }
    } catch (error) {
      console.error("Erro ao preparar mensagem ou documento:", error);
      toast(error.message || "Não foi possível preparar o envio.");
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }));
}

function bindSecretaryChat(session) {
  $("[data-secretary-chat]")?.addEventListener("click", () => {
    const root = $("[data-login-root]");
    if ($("[data-secretary-chat-box]", root)) {
      const box = $("[data-secretary-chat-box]", root);
      box.hidden = !box.hidden;
      if (!box.hidden) renderPortalSupportChat(session, root);
      return;
    }
    root.insertAdjacentHTML("beforeend", `<section class="panel secretary-chat-box" data-secretary-chat-box><div class="portal-heading compact"><h3>Falar com a Secretaria</h3><button class="button ghost" type="button" data-chat-close aria-label="Fechar janela do chat">×</button></div><div data-portal-support-content></div></section>`);
    $("[data-chat-close]", root).addEventListener("click", () => { $("[data-secretary-chat-box]", root).hidden = true; });
    renderPortalSupportChat(session, root);
  });
}

function renderPortalSupportChat(session, root = $("[data-login-root]")) {
  const content = $("[data-portal-support-content]", root);
  const request = activeSupportRequest(String(session.id));
  if (request) {
    if (!supportMessagesLoaded) {
      content.innerHTML = `<p class="muted">Carregando conversa...</p>`;
      void ensureSupportMessagesLoaded(request.id).then(() => renderPortalSupportChat(session, root)).catch((error) => {
        console.error("Erro ao carregar mensagens do atendimento:", error);
        content.innerHTML = `<p class="muted">Não foi possível carregar as mensagens. Verifique a conexão e tente novamente.</p>`;
      });
      return;
    }
    content.innerHTML = `<p class="support-subject"><strong>${escapeHtml(request.subject)}</strong> · ${escapeHtml(request.status)}</p>${supportMessageList(request, session.role)}${supportComposer(request, session.role, String(session.id), session.name, session.role)}`;
  } else {
    const latest = latestSupportRequest(String(session.id));
    content.innerHTML = `${latest ? `<p class="support-closed-note">Este assunto foi encerrado. Inicie uma nova conversa se precisar.</p>` : `<p class="muted">Nossa equipe da Secretaria responderá por aqui.</p>`}${supportComposer(null, session.role, String(session.id), session.name, session.role)}`;
  }
  bindSupportComposer(content, () => renderPortalSupportChat(session, root));
}

function renderStaffPanel(session) {
  const root = $("[data-login-root]");
  const employee = state.staff.find((item) => idsEqual(item.id, session.id));
  if (!employee) { clearSession(); return renderLoginForm(); }
  if (employee.sector === "cozinha") return renderKitchenPanel(session, employee);
  if (employee.sector === "secretaria") return renderSecretaryPanel(session, employee);
  const notes = privateNotificationsFor(session).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const records = state.sectorRecords.filter((item) => item.sector === employee.sector).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const modules = sectorModules[employee.sector] || [];
  root.innerHTML = `
    <div class="portal-heading"><div><h2>${escapeHtml(sectorLabels[employee.sector] || "Funcionário")}: ${escapeHtml(employee.name)}</h2><p class="muted">Painel interno. Os avisos abaixo não são publicados no site.</p></div><div class="row-actions">${notificationBell(session)}${passwordChangeButton(session)}<button class="button ghost" data-logout>Sair</button></div></div>
    <div class="segmented">${["overview", "records"].map((view) => `<button type="button" class="${currentStaffView === view ? "active" : ""}" data-staff-view="${view}">${view === "overview" ? "Painel" : "Registros"}</button>`).join("")}</div>
    ${currentStaffView === "overview" ? `<div class="staff-grid"><section class="panel"><h3>Avisos recebidos</h3>${notes.map((note) => `<article class="list-item"><div><strong>${escapeHtml(note.title)}</strong><p class="muted">${escapeHtml(note.message)}</p></div></article>`).join("") || emptyState("Nenhum aviso para você.")}</section><section class="panel"><h3>Ferramentas do setor</h3><div class="list-view">${modules.map((module) => `<article class="list-item"><div><strong>${escapeHtml(module)}</strong><p class="muted">Registre e acompanhe as demandas deste item na aba Registros.</p></div></article>`).join("")}</div></section></div>` : `
      <section class="panel"><h3>Novo registro</h3><form class="contact-form" data-sector-record-form><label>Área<select class="input" name="module" required>${buildOptions(modules)}</select></label><label>Título<input class="input" name="title" required></label><label>Detalhes<textarea class="input" name="details" rows="4" required></textarea></label><button class="button primary">Salvar registro</button></form></section>
      <section class="panel"><h3>Registros do setor</h3><div class="list-view">${records.map((record) => `<article class="list-item"><div><strong>${escapeHtml(record.module)} — ${escapeHtml(record.title)}</strong><p class="muted">${escapeHtml(record.details)}</p></div></article>`).join("") || emptyState("Ainda não há registros.")}</div></section>`}
  `;
  if (employee.sector === "secretaria" && currentStaffView === "overview") {
    root.insertAdjacentHTML("beforeend", `<section class="panel"><h3>Enviar aviso</h3><form class="contact-form" data-secretary-notification-form><label>Destinatário<select class="input" name="recipient"><option value="all_students">Alunos</option><option value="all_staff">Funcionários</option><option value="all_school">Toda a escola</option></select></label><label>Título<input class="input" name="title" required></label><label>Mensagem<textarea class="input" name="message" rows="3" required></textarea></label><button class="button primary">Enviar aviso</button></form></section>`);
  }
  root.insertAdjacentHTML("beforeend", renderSectorChecklists(session));
  bindSectorChecklists(session);
  $("[data-logout]").addEventListener("click", () => { clearSession(); renderLoginPortal(); });
  bindPasswordChange(session);
  $$('[data-staff-view]').forEach((button) => button.addEventListener("click", () => { currentStaffView = button.dataset.staffView; renderStaffPanel(session); }));
  $("[data-sector-record-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target);
    const saved = await upsertRecord("sector_records", { sector: employee.sector, module: form.get("module"), title: form.get("title"), details: form.get("details"), created_by: employee.id }, "id", "Registro salvo.", { skipPortalRender: true });
    if (saved) renderStaffPanel(session);
  });
  $("[data-secretary-notification-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target);
    const saved = await upsertRecord("private_notifications", { title: String(form.get("title")).trim(), message: String(form.get("message")).trim(), recipient_role: form.get("recipient") }, "id", "Aviso enviado.", { skipPortalRender: true });
    if (saved) renderStaffPanel(session);
  });
}

function renderSecretaryPanel(session, employee) {
  const root = $("[data-login-root]");
  root.innerHTML = `<div class="portal-heading"><div><h2>Secretaria Escolar: ${escapeHtml(employee.name)}</h2><p class="muted">Atendimentos, documentos e cadastros escolares.</p></div><div class="row-actions">${notificationBell(session)}${passwordChangeButton(session)}<button class="button ghost" data-logout>Sair</button></div></div><div class="segmented"><button class="active" data-secretary-tab="requests">Atendimentos</button><button data-secretary-tab="people">Escola</button><button data-secretary-tab="documents">Documentos</button></div><div data-secretary-content></div>`;

  root.insertAdjacentHTML("beforeend", renderSectorChecklists(session));
  bindSectorChecklists(session);
  const content = $("[data-secretary-content]");
  const openedSupportRequestIds = new Set();
  let activeTab = "requests";
  const show = (tab) => {
    activeTab = tab;
    $$("[data-secretary-tab]").forEach((button) => button.classList.toggle("active", button.dataset.secretaryTab === tab));
    if (tab === "people") {
      const staffRows = [
        ...state.teachers.filter((person) => person.user).map((person) => ({ name: person.name, role: "Professor(a)" })),
        ...state.staff.filter((person) => person.user).map((person) => ({ name: person.name, role: sectorLabels[person.sector] || person.sector }))
      ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      const students = [...state.students].sort((a, b) => `${getClassLabel(a.className)}|${a.name}`.localeCompare(`${getClassLabel(b.className)}|${b.name}`, "pt-BR"));
      content.innerHTML = `<section class="panel"><h3>Funcionários com login cadastrado</h3><div class="table-scroll"><table class="report-table"><thead><tr><th>Nome</th><th>Função</th></tr></thead><tbody>${staffRows.map((person) => `<tr><td>${escapeHtml(person.name)}</td><td>${escapeHtml(person.role)}</td></tr>`).join("") || `<tr><td colspan="2">Nenhum funcionário com login cadastrado.</td></tr>`}</tbody></table></div></section><section class="panel"><h3>Alunos por turma</h3><div class="table-scroll"><table class="report-table"><thead><tr><th>Turma</th><th>Aluno</th></tr></thead><tbody>${students.map((student) => `<tr><td>${escapeHtml(getClassLabel(student.className))}</td><td>${escapeHtml(student.name)}</td></tr>`).join("")}</tbody></table></div></section>`;
      return;
    }

    if (tab === "documents") {
      content.innerHTML = `<section class="panel"><h3>Enviar documento ao aluno</h3><form class="contact-form" data-document-form><label>Aluno<select class="input" name="student_id" required>${buildOptions(state.students.map((student) => ({ value: student.id, label: `${student.name} — ${getClassLabel(student.className)}` })) )}</select></label><label>Tipo<select class="input" name="document_type"><option>Diploma</option><option>Histórico escolar</option><option>Declaração</option></select></label><label>Arquivo<input class="input" name="file" type="file" accept=".pdf,.doc,.docx,image/*" required></label><button class="button primary">Enviar documento</button></form></section>`;
      $("[data-document-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        const file = form.get("file");
        if (!file?.size) return;
        const [attachment] = await readAttachments([file]);
        const saved = await upsertRecord("student_documents", { student_id: form.get("student_id"), document_type: form.get("document_type"), file: attachment }, "id", "Documento enviado.");
        if (saved) await upsertRecord("private_notifications", { title: "Novo documento", message: `A Secretaria enviou: ${form.get("document_type")}.`, recipient_student_id: form.get("student_id") }, "id", "", { skipPortalRender: true });
      });
      return;
    }

    const period = $("[data-support-period]", content)?.value || "all";
    const referenceDate = $("[data-support-date]", content)?.value || "";
    const range = dateRangeForPeriod(period, referenceDate);
    const requests = state.supportRequests
      .filter((item) => period === "all" || (schoolDateKey(item.created_at) >= range.start && schoolDateKey(item.created_at) <= range.end))
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    content.innerHTML = `<section class="panel"><div class="portal-heading compact"><div><h3>Chamados recebidos</h3><p class="muted">Consulte o conteúdo, remetente e data de cada atendimento.</p></div></div><div class="support-filters"><label>Período<select class="input" data-support-period><option value="all" ${period === "all" ? "selected" : ""}>Todos</option><option value="day" ${period === "day" ? "selected" : ""}>Dia</option><option value="week" ${period === "week" ? "selected" : ""}>Semana</option><option value="month" ${period === "month" ? "selected" : ""}>Mês</option><option value="year" ${period === "year" ? "selected" : ""}>Ano</option></select></label><label>Data de referência<input class="input" type="date" data-support-date value="${escapeHtml(referenceDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }))}"></label></div><div class="support-conversation-list">${requests.map((item) => {
      const isClosed = String(item.status || "").toLowerCase() === "encerrado";
      const requestId = String(item.id);
      const isOpen = openedSupportRequestIds.has(requestId);
      const messagesLoaded = supportMessagesLoaded || loadedSupportMessageRequestIds.has(requestId);
      const legacyFile = item.attachment?.data ? supportAttachmentLink(item.attachment) : "";
      const receivedDate = item.created_at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(item.created_at)) : "Data não informada";
      const conversation = isOpen
        ? messagesLoaded
          ? `${supportMessageList(item, "secretaria")}${isClosed ? `<p class="support-closed-note">Este assunto foi encerrado.</p>` : supportComposer(item, "secretaria", String(session.id), employee.name, "secretaria")}`
          : `<p class="muted">Carregando conversa...</p>`
        : "";
      return `<article class="support-thread-card"><header><div><strong>${escapeHtml(item.requester_name)} — ${escapeHtml(item.subject)}</strong><p class="muted">${escapeHtml(item.requester_role || "público")}${item.requester_contact ? ` · ${escapeHtml(item.requester_contact)}` : ""} · ${escapeHtml(item.status || "Aberto")}</p><p class="muted">Recebido em ${escapeHtml(receivedDate)}</p></div><div class="row-actions"><button class="button ghost" type="button" data-support-open="${escapeHtml(item.id)}">${isOpen ? "Ocultar conversa" : "Ver conversa"}</button>${isClosed ? `<span class="badge">Encerrado</span>` : `<button class="button ghost" type="button" data-support-close="${escapeHtml(item.id)}">Encerrar assunto</button>`}<button class="button ghost" type="button" data-support-delete="${escapeHtml(item.id)}">Excluir</button></div></header>${legacyFile ? `<div class="support-legacy-attachment">${legacyFile}</div>` : ""}${conversation}</article>`;
    }).join("") || emptyState("Nenhum atendimento recebido.")}</div></section>`;
    $$("[data-support-period], [data-support-date]", content).forEach((input) => input.addEventListener("change", () => show("requests")));
    bindSupportComposer(content, () => show("requests"));
    $$("[data-support-open]", content).forEach((button) => button.addEventListener("click", () => {
      const requestId = button.dataset.supportOpen;
      if (openedSupportRequestIds.has(requestId)) {
        openedSupportRequestIds.delete(requestId);
        show("requests");
        return;
      }
      openedSupportRequestIds.add(requestId);
      show("requests");
      if (supportMessagesLoaded || loadedSupportMessageRequestIds.has(requestId)) return;
      void ensureSupportMessagesLoaded(requestId).then(() => {
        if (activeTab === "requests" && openedSupportRequestIds.has(requestId)) show("requests");
      }).catch((error) => {
        console.error("Erro ao carregar mensagens do atendimento:", error);
        openedSupportRequestIds.delete(requestId);
        if (activeTab === "requests") show("requests");
        toast("Não foi possível carregar esta conversa. Tente novamente.");
      });
    }));
    $$("[data-support-close]", content).forEach((button) => button.addEventListener("click", async () => {
      const item = requests.find((request) => idsEqual(request.id, button.dataset.supportClose));
      if (!item || !window.confirm(`Encerrar o assunto "${item.subject}" de ${item.requester_name}?`)) return;
      const { data, error } = await supabase.from("support_requests").update({ status: "Encerrado", closed_at: new Date().toISOString() }).eq("id", item.id).select().single();
      if (error) {
        console.error("Erro ao encerrar atendimento:", error);
        return toast(`Não foi possível encerrar o atendimento: ${error.message || "tente novamente."}`);
      }
      Object.assign(item, data);
      clearCache("support_requests");
      toast("Assunto encerrado.");
      show("requests");
    }));
    $$("[data-support-delete]", content).forEach((button) => button.addEventListener("click", async () => {
      const item = requests.find((request) => idsEqual(request.id, button.dataset.supportDelete));
      if (!item || !window.confirm(`Excluir permanentemente o atendimento de ${item.requester_name} sobre "${item.subject}"?`)) return;
      const { error } = await supabase.from("support_requests").delete().eq("id", item.id);
      if (error) {
        console.error("Erro ao excluir atendimento:", error);
        return toast(`Não foi possível excluir o atendimento: ${error.message || "tente novamente."}`);
      }
      state.supportRequests = state.supportRequests.filter((request) => !idsEqual(request.id, item.id));
      state.supportMessages = state.supportMessages.filter((message) => !idsEqual(message.support_request_id, item.id));
      openedSupportRequestIds.delete(String(item.id));
      clearCache("support_requests");
      clearCache("support_messages");
      toast("Atendimento excluído.");
      show("requests");
    }));
  };

  $$("[data-secretary-tab]").forEach((button) => button.addEventListener("click", () => show(button.dataset.secretaryTab)));
  $("[data-logout]").addEventListener("click", () => { clearSession(); renderLoginPortal(); });
  bindPasswordChange(session);
  show("requests");
}

function renderKitchenPanel(session, employee) {
  const root = $("[data-login-root]");
  const today = new Date().toISOString().slice(0, 10);
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 5 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date.toISOString().slice(0, 10); });
  const weekdayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
  const menuByDay = Object.fromEntries(state.kitchenMenu.map((item) => [item.menu_date, item]));
  const low = state.kitchenStock.filter((item) => Number(item.quantity) <= Number(item.minimum_quantity) || (item.expiry_date && item.expiry_date <= new Date(Date.now()+7*864e5).toISOString().slice(0,10)));
  const expiringSoon = (date) => Boolean(date && date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const stockRows = state.kitchenStock.map((item) => {
    const isLow = Number(item.quantity) <= Number(item.minimum_quantity);
    const isExpiring = expiringSoon(item.expiry_date);
    const status = isLow ? "Estoque mínimo" : isExpiring ? "Validade próxima" : "Disponível";
    return `<tr data-stock-row data-name="${escapeHtml(normalizeLabel(item.name))}" data-quantity="${item.quantity}" data-expiry="${escapeHtml(item.expiry_date || "9999-12-31")}" data-low="${isLow}" data-expiring="${isExpiring}"><td>${escapeHtml(item.name)}</td><td>${item.quantity} ${escapeHtml(item.unit || "")}</td><td>${item.minimum_quantity}</td><td>${escapeHtml(item.expiry_date || "—")}</td><td>${status}</td><td><div class="row-actions"><button class="button ghost" type="button" data-stock-edit="${escapeHtml(item.id)}">Alterar</button><button class="button danger" type="button" data-stock-delete="${escapeHtml(item.id)}">Apagar</button></div></td></tr>`;
  }).join("");

  root.innerHTML = `<div class="kitchen-portal"><div class="portal-heading kitchen-heading"><div><span class="kitchen-eyebrow">GESTÃO DA MERENDA</span><h2>Cozinha / Merenda: ${escapeHtml(employee.name)}</h2><p class="muted">Confirme o preparo para registrar a baixa dos ingredientes.</p></div><div class="row-actions">${notificationBell(session)}${passwordChangeButton(session)}<button class="button ghost" data-logout>Sair</button></div></div><div class="kitchen-summary"><article><span>Cardápios na semana</span><strong>${state.kitchenMenu.filter((item) => weekDays.includes(item.menu_date)).length}</strong></article><article class="${low.length ? "attention" : ""}"><span>Itens em atenção</span><strong>${low.length}</strong></article><article><span>Estoque cadastrado</span><strong>${state.kitchenStock.length}</strong></article></div><div class="segmented kitchen-tabs"><button class="${currentKitchenView === "operations" ? "active" : ""}" data-kitchen-view="operations">Operação</button><button class="${currentKitchenView === "reports" ? "active" : ""}" data-kitchen-view="reports">Relatórios de estoque</button></div>
  ${currentKitchenView === "reports" ? `<section class="panel"><h3>Relatório de estoque</h3><div class="toolbar"><input class="input" data-stock-filter type="search" placeholder="Filtrar por alimento"><select class="input" data-stock-status><option value="">Todas as situações</option><option value="low">Estoque mínimo</option><option value="expiry">Validade próxima</option><option value="available">Disponível</option></select><select class="input" data-stock-order><option value="name">Ordenar: alimento</option><option value="quantity">Ordenar: quantidade</option><option value="expiry">Ordenar: validade</option></select></div><div class="table-scroll"><table class="report-table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Mínimo</th><th>Validade</th><th>Situação</th><th>Ações</th></tr></thead><tbody data-stock-report>${stockRows || `<tr><td colspan="6">Nenhum item cadastrado.</td></tr>`}</tbody></table></div><form class="contact-form" data-stock-edit-form hidden><h4>Alterar alimento</h4><input type="hidden" name="id"><label>Produto<input class="input" name="name" required></label><label>Quantidade atual<input class="input" name="quantity" type="number" min="0" step="0.01" required></label><label>Unidade<input class="input" name="unit" placeholder="kg, L, unidade"></label><label>Estoque mínimo<input class="input" name="minimum_quantity" type="number" min="0" step="0.01" required></label><label>Validade<input class="input" name="expiry_date" type="date"></label><div class="row-actions"><button class="button primary" type="submit">Salvar alterações</button><button class="button ghost" type="button" data-stock-edit-cancel>Cancelar</button></div></form></section>` : `
  <section class="panel"><h3>Cardápio nutricional — semana</h3><div class="table-scroll"><table class="report-table"><thead><tr><th>Dia</th><th>Cardápio planejado</th><th>Ingredientes</th><th>Confirmação</th></tr></thead><tbody>${weekDays.map((date, index) => { const item = menuByDay[date]; const done = item?.status || ""; return `<tr><td><strong>${weekdayNames[index]}</strong></td><td>${escapeHtml(item?.meal || "Não publicado")}${item?.actual_meal ? `<br><small>Realizado: ${escapeHtml(item.actual_meal)}</small>` : ""}</td><td>${escapeHtml(item?.ingredients || "—")}</td><td>${!item ? "—" : done ? `<span class="badge">${escapeHtml(done)}</span>` : `<div class="row-actions"><button class="button primary" data-kitchen-made data-id="${item.id}">Fez</button><button class="button ghost" data-kitchen-no-class data-id="${item.id}">Sem aula</button><button class="button ghost" data-kitchen-change data-id="${item.id}">Mudou</button></div>`}</td></tr>`; }).join("")}</tbody></table></div></section>
  <section class="panel"><h3>Estoque e validade</h3>${low.length ? `<p class="warning-text">${low.length} item(ns) exigem atenção: estoque mínimo ou validade próxima.</p>` : ""}<div class="table-scroll"><table class="report-table"><thead><tr><th>Produto</th><th>Quantidade disponível</th><th>Mínimo</th><th>Validade</th></tr></thead><tbody>${state.kitchenStock.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td><strong>${item.quantity} ${escapeHtml(item.unit || "")}</strong></td><td>${item.minimum_quantity}</td><td>${escapeHtml(item.expiry_date || "—")}</td></tr>`).join("") || `<tr><td colspan="4">Nenhum item cadastrado.</td></tr>`}</tbody></table></div><form class="contact-form" data-kitchen-stock-form><h4>Registrar quantidade em estoque</h4><label>Produto<input class="input" name="name" required></label><label>Quantidade atual<input class="input" name="quantity" type="number" min="0" step="0.01" required></label><label>Unidade<input class="input" name="unit" placeholder="kg, L, unidade"></label><label>Estoque mínimo<input class="input" name="minimum_quantity" type="number" min="0" step="0.01" required></label><label>Validade<input class="input" name="expiry_date" type="date"></label><button class="button primary">Salvar estoque</button></form><form class="contact-form" data-restock-form><label>Itens para reposição<textarea class="input" name="items" rows="3" required placeholder="Ex.: Arroz 10 kg; leite 20 L"></textarea></label><button class="button primary">Solicitar reposição à administração</button></form></section>
  <section class="panel"><h3>Restrições alimentares</h3><div class="list-view">${state.dietaryRestrictions.map((item) => { const student = state.students.find((person) => idsEqual(person.id, item.student_id)); return `<article class="list-item"><div><strong>${escapeHtml(student?.name || item.student_name || "Aluno")}${student ? ` — ${escapeHtml(getClassLabel(student.className))}` : item.class_name ? ` — ${escapeHtml(item.class_name)}` : ""}</strong><p class="muted">${escapeHtml(item.restriction)}</p></div></article>`; }).join("") || emptyState("Nenhuma restrição cadastrada.")}</div></section>`}</div>`;
  root.insertAdjacentHTML("beforeend", renderSectorChecklists(session));
  bindSectorChecklists(session);
  $("[data-logout]").addEventListener("click", () => { clearSession(); renderLoginPortal(); });
  bindPasswordChange(session);
  $$('[data-kitchen-view]').forEach((button) => button.addEventListener("click", () => { currentKitchenView = button.dataset.kitchenView; renderKitchenPanel(session, employee); }));
  root.insertAdjacentHTML("beforeend", `<section class="panel"><h3>Baixa diária de produtos</h3><p class="muted">Registre os produtos utilizados; o saldo é atualizado imediatamente.</p><form class="contact-form" data-kitchen-consumption-form><label>Produto<select class="input" name="stock_id" required><option value="">Selecione</option>${state.kitchenStock.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${item.quantity} ${escapeHtml(item.unit || "")}</option>`).join("")}</select></label><label>Quantidade utilizada<input class="input" name="quantity" type="number" min="0.01" step="0.01" required></label><label>Observação<input class="input" name="note" placeholder="Ex.: almoço"></label><button class="button primary">Baixar do estoque</button></form></section>`);
  $("[data-kitchen-consumption-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.target); const stock = state.kitchenStock.find((item) => idsEqual(item.id, form.get("stock_id"))); const used = Number(form.get("quantity")); if (!stock || !Number.isFinite(used) || used <= 0 || used > Number(stock.quantity)) return toast("Informe uma quantidade válida, menor ou igual ao estoque disponível."); const saved = await upsertRecord("kitchen_stock", { ...stock, quantity: Number(stock.quantity) - used }, "id", "Baixa de estoque registrada.", { skipPortalRender: true }); if (saved) renderKitchenPanel(session, employee); });
  const applyStockFilters = () => { const text = normalizeLabel($("[data-stock-filter]")?.value || ""); const status = $("[data-stock-status]")?.value || ""; $$('[data-stock-row]').forEach((row) => { row.hidden = Boolean(text && !row.dataset.name.includes(text)) || (status === "low" && row.dataset.low !== "true") || (status === "expiry" && row.dataset.expiring !== "true") || (status === "available" && (row.dataset.low === "true" || row.dataset.expiring === "true")); }); };
  $("[data-stock-filter]")?.addEventListener("input", applyStockFilters); $("[data-stock-status]")?.addEventListener("change", applyStockFilters); $("[data-stock-order]")?.addEventListener("change", (event) => { const body = $("[data-stock-report]"); if (!body) return; [...$$('[data-stock-row]', body)].sort((a,b) => String(a.dataset[event.target.value] || "").localeCompare(String(b.dataset[event.target.value] || ""), "pt-BR", { numeric: true })).forEach((row) => body.append(row)); });
  $$("[data-stock-edit]").forEach((button) => button.addEventListener("click", () => {
    const item = state.kitchenStock.find((stock) => idsEqual(stock.id, button.dataset.stockEdit));
    const form = $("[data-stock-edit-form]");
    if (!item || !form) return;
    form.elements.namedItem("id").value = item.id;
    form.elements.namedItem("name").value = item.name || "";
    form.elements.namedItem("quantity").value = item.quantity ?? 0;
    form.elements.namedItem("unit").value = item.unit || "";
    form.elements.namedItem("minimum_quantity").value = item.minimum_quantity ?? 0;
    form.elements.namedItem("expiry_date").value = item.expiry_date || "";
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
  $$("[data-stock-delete]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.kitchenStock.find((stock) => idsEqual(stock.id, button.dataset.stockDelete));
    if (!item || !window.confirm(`Apagar o alimento ${item.name}?`)) return;
    await deleteRecord("kitchen_stock", "id", item.id, "Alimento removido.");
  }));
  $("[data-stock-edit-cancel]")?.addEventListener("click", () => {
    const form = $("[data-stock-edit-form]");
    if (form) {
      form.reset();
      form.hidden = true;
    }
  });
  $("[data-stock-edit-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const saved = await upsertRecord("kitchen_stock", {
      id: form.get("id"),
      name: String(form.get("name")).trim(),
      quantity: form.get("quantity"),
      unit: String(form.get("unit") || "").trim(),
      minimum_quantity: form.get("minimum_quantity"),
      expiry_date: form.get("expiry_date") || null
    }, "id", "Alimento atualizado.", { skipPortalRender: true });
    if (saved) renderKitchenPanel(session, employee);
  });
  $$('[data-kitchen-made]').forEach((button) => button.addEventListener("click", async () => {
    const item = state.kitchenMenu.find((menuItem) => idsEqual(menuItem.id, button.dataset.id)); if (!item) return;
    const ingredients = String(item.ingredients || "").split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    for (const entry of ingredients) { const [name, amount] = entry.split(":").map((value) => value.trim()); const stock = state.kitchenStock.find((s) => normalizeLabel(s.name) === normalizeLabel(name)); if (stock && Number(amount)) await upsertRecord("kitchen_stock", { ...stock, quantity: Math.max(0, Number(stock.quantity) - Number(amount)) }, "id", "", { skipPortalRender: true }); }
    await upsertRecord("kitchen_menu", { ...item, status: "Preparado", prepared_at: new Date().toISOString(), prepared_by: employee.id }, "id", "Preparo confirmado e estoque atualizado.", { skipPortalRender: true }); renderKitchenPanel(session, employee);
  }));
  $$('[data-kitchen-no-class]').forEach((button) => button.addEventListener("click", async () => { const item = state.kitchenMenu.find((entry) => idsEqual(entry.id, button.dataset.id)); if (item) { await upsertRecord("kitchen_menu", { ...item, status: "Não houve aula" }, "id", "Dia marcado sem aula.", { skipPortalRender: true }); renderKitchenPanel(session, employee); } }));
  $$('[data-kitchen-change]').forEach((button) => button.addEventListener("click", async () => { const item = state.kitchenMenu.find((entry) => idsEqual(entry.id, button.dataset.id)); const meal = window.prompt("Qual cardápio foi preparado?"); if (!item || !meal?.trim()) return; const used = window.prompt("Ingredientes usados para baixa (ex.: Arroz: 2; Leite: 1)") || ""; for (const entry of used.split(/[;,]/).map((value) => value.trim()).filter(Boolean)) { const [name, amount] = entry.split(":").map((value) => value.trim()); const stock = state.kitchenStock.find((s) => normalizeLabel(s.name) === normalizeLabel(name)); if (stock && Number(amount)) await upsertRecord("kitchen_stock", { ...stock, quantity: Math.max(0, Number(stock.quantity) - Number(amount)) }, "id", "", { skipPortalRender: true }); } await upsertRecord("kitchen_menu", { ...item, status: "Cardápio alterado", actual_meal: meal.trim() }, "id", "Alteração registrada e estoque atualizado.", { skipPortalRender: true }); renderKitchenPanel(session, employee); }));
  $("[data-kitchen-stock-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get("name")).trim();
    const existing = state.kitchenStock.find((item) => normalizeLabel(item.name) === normalizeLabel(name));
    const saved = await upsertRecord("kitchen_stock", { ...(existing ? { id: existing.id } : {}), name, quantity: form.get("quantity"), unit: form.get("unit"), minimum_quantity: form.get("minimum_quantity"), expiry_date: form.get("expiry_date") || null }, "id", "Alimento salvo.", { skipPortalRender: true });
    if (saved) {
      currentKitchenView = "reports";
      renderKitchenPanel(session, employee);
    }
  });
  $("[data-restock-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); const items = new FormData(event.target).get("items"); await upsertRecord("private_notifications", { title: "Solicitação de reposição — Cozinha", message: String(items), recipient_role: "all_admins" }, "id", "Solicitação enviada.", { skipPortalRender: true }); event.target.reset(); });
}

async function syncAdminData(message, { skipPortalRender = false } = {}) {
  hasUnsavedFormChanges = false;
  if (currentPageName() === "login" && !skipPortalRender) {
    renderLoginPortal();
  } else {
    renderVisiblePublicPage();
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
    staff: "Funcionários",
    director: "Diretor",
    notifications: "Avisos",
    kitchen: "Cozinha",
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
        ${["dashboard", "director", "school", "catalog", "students", "teachers", "staff", "kitchen", "notifications", "grades", "content"]
          .map((tab) => `<button data-admin-tab="${tab}" class="${currentAdminTab === tab ? "active" : ""}">${tabLabel(tab)}</button>`)
          .join("")}
        ${notificationBell(session)}
        ${passwordChangeButton(session)}
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
  bindPasswordChange(session);

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
        ${miniStat("Funcionários", state.staff.length)}
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

  if (currentAdminTab === "director") {
    renderDirectorAdmin(content);
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

  if (currentAdminTab === "staff") {
    renderStaffAdmin(content);
    return;
  }

  if (currentAdminTab === "notifications") {
    renderNotificationsAdmin(content);
    return;
  }

  if (currentAdminTab === "kitchen") { renderKitchenAdmin(content); return; }

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

function applySavedRecord(table, record) {
  const collectionByTable = {
    classes: "classes",
    subjects: "subjects",
    students: "students",
    teachers: "teachers",
    staff: "staff",
    private_notifications: "notifications",
    sector_records: "sectorRecords",
    kitchen_menu: "kitchenMenu",
    kitchen_stock: "kitchenStock",
    dietary_restrictions: "dietaryRestrictions",
    support_requests: "supportRequests",
    student_documents: "studentDocuments",
    grades: "grades",
    news: "news",
    events: "events",
    activities: "activities",
    achievements: "achievements"
  };
  const collectionName = collectionByTable[table];
  if (!collectionName || !record) return;
  const normalize = table === "students" ? normalizeStudentData : table === "teachers" ? normalizeTeacherData : table === "grades" ? normalizeGradeData : (value) => value;
  const collection = state[collectionName];
  const index = collection.findIndex((item) => idsEqual(item.id, record.id));
  if (index >= 0) collection[index] = normalize(record);
  else collection.push(normalize(record));
  if (["classes", "subjects", "students", "teachers"].includes(table)) state[collectionName] = sortPeopleByName(state[collectionName]);
  state.indicators = {
    students: state.students.length,
    projects: state.activities.length,
    events: state.events.length,
    awards: state.achievements.length
  };
}

async function saveSchoolConfig(payload) {
  try {
    const request = state.schoolConfigId != null
      ? supabase.from("school_config").update(payload).eq("id", state.schoolConfigId)
      : supabase.from("school_config").insert(payload);
    const { data: savedData, error } = await request.select();

    if (error) throw error;
    if (!savedData?.length) throw new Error("O banco não confirmou o salvamento da configuração da escola.");

    state.schoolConfigId = savedData[0].id ?? state.schoolConfigId;
    clearCache("school_config");
    await syncAdminData("Configuração da escola salva.");
    return true;
  } catch (error) {
    console.error("Erro ao salvar a configuração da escola:", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    toast(error?.message ? `Erro ao salvar: ${error.message}` : "Erro ao salvar a configuração da escola.");
    return false;
  }
}

async function upsertRecord(table, payload, conflict = "id", successMessage = "Registro salvo com sucesso.", options = {}) {
  if (isSavingRecord) {
    toast("Um salvamento já está em andamento. Aguarde a confirmação.");
    return false;
  }
  isSavingRecord = true;
  try {
    console.log("Tabela:", table);
    console.log("Payload:", payload);

    // Bancos antigos podem usar uma coluna `id` numérica gerada pelo próprio
    // PostgreSQL (GENERATED ALWAYS). Para novos registros sem id, fazemos um
    // INSERT e deixamos o banco atribuir o valor; para edições e catálogos,
    // preservamos o UPSERT com a chave de conflito apropriada.
    const hasId = payload.id != null && payload.id !== "";
    const { id, ...recordWithoutId } = payload;
    const request = conflict === "id"
      ? hasId
        ? supabase.from(table).update(recordWithoutId).eq("id", id)
        : supabase.from(table).insert([recordWithoutId])
      : supabase.from(table).upsert([payload], { onConflict: conflict });
    const { data: savedData, error } = await request.select();

    if (error) throw error;
    if (!savedData?.length) throw new Error(`O banco não confirmou o salvamento em ${table}.`);
    console.log("Data:", savedData);

    const savedRecord = savedData[0];
    applySavedRecord(table, savedRecord);
    clearCache(table);
    await syncAdminData(successMessage, options);
    return savedRecord;

  } catch (error) {
    // `console.error(error)` costuma aparecer apenas como "Object" no DevTools.
    // Estes campos sao a resposta util devolvida pelo PostgREST/Supabase.
    console.error("Erro completo:", {
      table,
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    const databaseNeedsUpdate = error?.code === "PGRST204" || error?.code === "PGRST205" || error?.code === "42501";
    const missingTable = error?.message?.match(/Could not find the table 'public\.([^']+)'/i)?.[1];
    const missingConflictConstraint = error?.code === "42P10";
    const missingColumn = error?.message?.match(/(?:Could not find the '([^']+)' column|column [^.]+\.([^ ]+) does not exist)/)?.slice(1).find(Boolean);
    toast(
      missingConflictConstraint
        ? `A tabela ${table} nao possui uma chave unica para “${conflict}”. Execute supabase-add-attachments.sql no Supabase.`
        : missingTable
        ? `A tabela “${missingTable}” ainda não existe no Supabase. Execute o arquivo supabase-create-missing-tables.sql no SQL Editor e atualize esta página.`
        : databaseNeedsUpdate
        ? missingColumn
          ? `Falta a coluna “${missingColumn}” no banco. Execute novamente supabase-add-attachments.sql no Supabase.`
          : "Banco desatualizado ou sem permissão. Execute novamente supabase-add-attachments.sql no Supabase."
        : error?.message
        ? `Erro ao salvar: ${error.message}`
        : `Erro ao salvar ${table}.`
    );
    return false;
  } finally {
    isSavingRecord = false;
  }
}
async function deleteRecord(table, column, value, successMessage = "Registro removido com sucesso.") {
  try {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) throw error;
    const collectionName = ({ classes: "classes", subjects: "subjects", students: "students", teachers: "teachers", staff: "staff", private_notifications: "notifications", sector_records: "sectorRecords", kitchen_menu: "kitchenMenu", kitchen_stock: "kitchenStock", dietary_restrictions: "dietaryRestrictions", support_requests: "supportRequests", student_documents: "studentDocuments", grades: "grades", news: "news", events: "events", activities: "activities", achievements: "achievements" })[table];
    if (collectionName) state[collectionName] = state[collectionName].filter((item) => !idsEqual(item[column], value));
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
        <p class="muted">Edite história, missão, visão, valores, contato e equipe institucional.</p>
      </div>
    </div>
    <form class="panel contact-form" data-school-form>
      <label>História<textarea class="input" name="history" rows="4">${escapeHtml(config.history)}</textarea></label>
      <label>Missão<textarea class="input" name="mission" rows="3">${escapeHtml(config.mission)}</textarea></label>
      <label>Visão<textarea class="input" name="vision" rows="3">${escapeHtml(config.vision)}</textarea></label>
      <label>Valores<textarea class="input" name="values" rows="3">${escapeHtml(config.values)}</textarea></label>
      <label>Endereço<input class="input" name="address" value="${escapeHtml(config.address)}"></label>
      <label>Telefone<input class="input" name="phone" value="${escapeHtml(config.phone)}"></label>
      <label>E-mail<input class="input" name="email" type="email" value="${escapeHtml(config.email)}"></label>
      <label>Equipe institucional<textarea class="input" name="team" rows="5" placeholder="Nome | Cargo">${escapeHtml(
        (config.team || []).map((person) => `${person.name} | ${person.role}`).join("\n")
      )}</textarea></label>
      <button class="button primary" type="submit">Salvar configuração</button>
    </form>
  `;

  $("[data-school-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const team = parseCommaList(form.get("team"))
      .map((line) => line.split("|").map((part) => part.trim()))
      .filter((parts) => parts[0])
      .map(([name, role]) => ({ name, role: role || "Equipe" }));

    await saveSchoolConfig({
      history: form.get("history"),
      mission: form.get("mission"),
      vision: form.get("vision"),
      values: form.get("values"),
      address: form.get("address"),
      phone: form.get("phone"),
      email: form.get("email"),
      team
    });
  });
}

async function optimizeImage(file) {
  const canOptimize = file.type.startsWith("image/") && file.type !== "image/svg+xml" && file.size > 500 * 1024;
  if (!canOptimize) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = objectUrl;
    });
    const maxDimension = 1920;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.82));
    if (!blob || blob.size >= file.size) return file;
    const name = type === "image/jpeg" ? file.name.replace(/\.[^.]+$/, ".jpg") : file.name;
    return new File([blob], name, { type });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function deleteStudent(student) {
  if (!student) return;
  if (!window.confirm(`Excluir ${student.name}? As notas vinculadas a este aluno também serão removidas.`)) return;
  try {
    // Compatibilidade com bancos antigos sem a regra ON DELETE CASCADE nas notas.
    let { error: studentError } = await supabase.from("students").delete().eq("id", student.id);
    if (studentError?.code === "23503") {
      let gradesError = null;
      for (const column of ["studentId", "studentid", "student_id"]) {
        const result = await supabase.from("grades").delete().eq(column, student.id);
        if (!result.error) {
          gradesError = null;
          break;
        }
        gradesError = result.error;
      }
      if (gradesError) throw gradesError;
      ({ error: studentError } = await supabase.from("students").delete().eq("id", student.id));
    }
    if (studentError) throw studentError;
    state.students = state.students.filter((item) => !idsEqual(item.id, student.id));
    state.grades = state.grades.filter((grade) => !idsEqual(grade.studentId, student.id));
    clearCache("grades");
    clearCache("students");
    await syncAdminData("Aluno e notas vinculadas removidos.");
  } catch (error) {
    console.error("Erro ao remover aluno:", error);
    toast(error?.message ? `Não foi possível remover o aluno: ${error.message}` : "Não foi possível remover o aluno.");
  }
}

function graduationDocumentContent(student, type) {
  const completedClass = student.graduationClassName || getClassLabel(student.className);
  const completedDate = student.graduationDate ? new Date(`${student.graduationDate}T12:00:00`).toLocaleDateString("pt-BR") : new Date().toLocaleDateString("pt-BR");
  if (type === "diploma") {
    return `<section class="document-copy"><p>Certificamos que <strong>${escapeHtml(student.name)}</strong> concluiu o curso de ensino médio nesta instituição, tendo cumprido os requisitos acadêmicos previstos.</p><p>Turma de conclusão: <strong>${escapeHtml(completedClass)}</strong>.</p><p>Francisco Macedo - PI, ${escapeHtml(completedDate)}.</p><div class="document-signatures"><span>________________________________<br>Direção escolar</span><span>________________________________<br>Secretaria escolar</span></div></section>`;
  }
  const grades = state.grades.filter((grade) => idsEqual(grade.studentId, student.id));
  const rows = grades.map((grade) => `<tr><td>${escapeHtml(getSubjectLabel(grade.subject))}</td><td>${escapeHtml(grade.className || completedClass)}</td><td>${escapeHtml(gradeAverage(grade))}</td><td>${Number(gradeAverage(grade)) >= 6 ? "Aprovado" : "Pendente"}</td></tr>`).join("");
  return `<section class="document-copy"><p>Histórico escolar provisório de <strong>${escapeHtml(student.name)}</strong>, concluinte da turma <strong>${escapeHtml(completedClass)}</strong>.</p><table><thead><tr><th>Disciplina</th><th>Turma</th><th>Média final</th><th>Situação</th></tr></thead><tbody>${rows || "<tr><td colspan=\"4\">Não há notas registradas.</td></tr>"}</tbody></table><p>Documento emitido em ${escapeHtml(completedDate)}. Modelo provisório sujeito à conferência e validação da secretaria escolar.</p><div class="document-signatures"><span>________________________________<br>Secretaria escolar</span></div></section>`;
}

function generateGraduationDocument(student, type) {
  const label = type === "diploma" ? "Diploma" : "Histórico escolar";
  generatePdfReport(`${label} - ${student.name}`, graduationDocumentContent(student, type), { studentName: student.name, className: student.graduationClassName || getClassLabel(student.className) });
}

async function fileToDataUrl(file) {
  return readFileAsDataUrl(await optimizeImage(file));
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
        const { data, error } = await supabase.from("classes").update({ name }).eq("name", current).select().single();
        if (error) throw error;
        applySavedRecord("classes", data);
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
        const { data, error } = await supabase.from("subjects").update({ name }).eq("name", current).select().single();
        if (error) throw error;
        applySavedRecord("subjects", data);
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
      <p class="muted">O usuário é criado automaticamente usando o primeiro nome. Se ele já estiver em uso, o sistema acrescenta o sobrenome; somente depois usa um número. A senha inicial é <strong>1234</strong> e deve ser alterada no primeiro acesso.</p>
      <label class="checkbox-row"><input type="checkbox" name="isJournalist"${editing?.isJournalist ? " checked" : ""}> Aluno jornalista — pode criar matérias para o jornal escolar</label>
      <div class="row-actions">
        <button class="button primary" type="submit">${editing ? "Atualizar aluno" : "Salvar aluno"}</button>
        ${editing ? '<button class="button ghost" type="button" data-student-cancel>Cancelar edição</button>' : ""}
      </div>
    </form>
    <section class="panel year-transition-panel">
      <h3>Encerramento do ano letivo</h3>
      <p class="muted">Transfira somente alunos aprovados com todas as notas lançadas. Apenas alunos aprovados do 3º ano podem ser marcados como formados.</p>
      <div class="form-grid">
        <label>Turma atual<select class="input" data-promotion-source><option value="">Selecione</option>${buildOptions(state.classes.map((item) => ({ value: item.name, label: item.name })))}</select></label>
        <label>Destino<select class="input" data-promotion-target><option value="">Selecione</option>${buildOptions(state.classes.map((item) => ({ value: item.name, label: item.name })))}</select></label>
      </div>
      <p class="muted" data-promotion-summary>Selecione uma turma para conferir os alunos aptos.</p>
      <div class="row-actions"><button class="button primary" type="button" data-promote-students>Transferir aprovados</button><button class="button ghost" type="button" data-graduate-students>Marcar como formados</button></div>
    </section>
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
                <article class="list-item admin-record" data-student-row data-student-name="${escapeHtml(normalizeLabel(student.name))}" data-student-user="${escapeHtml(normalizeLabel(student.user))}" data-student-class="${escapeHtml(normalizeLabel(getClassLabel(student.className)))}">
                  <div>
                    <strong>${escapeHtml(student.name)}</strong>
                    ${student.isJournalist ? '<span class="badge">Aluno jornalista</span>' : ""}
                    <p class="muted">${escapeHtml(getClassLabel(student.className))}${student.user ? ` | @${escapeHtml(student.user)}` : ""}</p>
                    <p class="muted"><strong>Situação:</strong> ${escapeHtml(studentYearStatus(student))}</p>
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
                    ${(student.isGraduated || student.is_graduated) ? `<button class="button ghost" type="button" data-student-diploma data-id="${escapeHtml(student.id)}">Diploma</button><button class="button ghost" type="button" data-student-history data-id="${escapeHtml(student.id)}">Histórico</button>` : ""}
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
      const existingUsernames = getExistingUsernames();
      const existingStudents = new Set(state.students.map((student) => `${normalizeLabel(student.name)}|${normalizeLabel(student.className)}`));
      const rowsToInsert = bulkStudents
        .map((student) => {
          const key = `${normalizeLabel(student.name)}|${normalizeLabel(student.className)}`;
          if (existingStudents.has(key)) return null;
          const user = createStudentUsername(student.name, existingUsernames, student.user || "");
          existingStudents.add(key);
          return {
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
    const existingUsernames = getExistingUsernames(id);
    const user = createStudentUsername(String(form.get("name") || ""), existingUsernames, id ? String(form.get("user") || "") : "");
    const payload = {
      ...(id ? { id } : {}),
      name: String(form.get("name") || "").trim(),
      className: String(form.get("className") || "").trim(),
      user,
      // A coluna pode ser NOT NULL em bancos criados por versoes anteriores.
      // Inclui-la tambem nas edicoes evita que o upsert tente inserir NULL caso
      // o identificador do registro nao seja encontrado.
      password: normalizePassword(editing?.password) || DEFAULT_STUDENT_PASSWORD,
      is_journalist: Boolean(form.get("isJournalist"))
    };
    if (!id) {
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
    studentUserInput.value = createStudentUsername(studentNameInput.value, getExistingUsernames());
  });

  const promotionSource = $("[data-promotion-source]");
  const promotionTarget = $("[data-promotion-target]");
  const promotionSummary = $("[data-promotion-summary]");
  const getEligibleStudents = () => state.students.filter((student) => getClassLabel(student.className) === getClassLabel(promotionSource?.value) && !(student.isGraduated || student.is_graduated) && isStudentApprovedForYear(student));
  const updatePromotionSummary = () => {
    if (!promotionSource?.value) return;
    promotionSummary.textContent = `${getEligibleStudents().length} aluno(s) aprovado(s) e com todas as notas lançadas na turma ${promotionSource.value}.`;
  };
  promotionSource?.addEventListener("change", updatePromotionSummary);
  $("[data-promote-students]")?.addEventListener("click", async () => {
    const eligible = getEligibleStudents();
    if (!promotionSource?.value || !promotionTarget?.value) return toast("Selecione a turma atual e a próxima turma.");
    if (getClassLabel(promotionSource.value) === getClassLabel(promotionTarget.value)) return toast("A próxima turma deve ser diferente da turma atual.");
    if (!eligible.length) return toast("Não há alunos aptos para transferir nesta turma.");
    if (!window.confirm(`Transferir ${eligible.length} aluno(s) aprovado(s) para ${promotionTarget.value}?`)) return;
    const classColumn = eligible[0].classname !== undefined ? "classname" : "className";
    const { error } = await supabase.from("students").update({ [classColumn]: promotionTarget.value, is_graduated: false, graduation_classname: null, graduation_date: null }).in("id", eligible.map((student) => student.id));
    if (error) return toast(`Não foi possível transferir os alunos: ${error.message}`);
    clearCache("students");
    await syncAdminData(`${eligible.length} aluno(s) transferido(s) para ${promotionTarget.value}.`);
  });
  $("[data-graduate-students]")?.addEventListener("click", async () => {
    const eligible = getEligibleStudents();
    if (!promotionSource?.value) return toast("Selecione a turma dos concluintes.");
    if (!isFinalYearClass(promotionSource.value)) return toast("Somente alunos do 3º ano podem ser marcados como formados.");
    if (!eligible.length) return toast("Não há alunos aptos para concluir nesta turma.");
    if (!window.confirm(`Marcar ${eligible.length} aluno(s) como formados?`)) return;
    const { error } = await supabase.from("students").update({ is_graduated: true, graduation_classname: promotionSource.value, graduation_date: new Date().toISOString().slice(0, 10) }).in("id", eligible.map((student) => student.id));
    if (error) return toast(`Não foi possível concluir os alunos: ${error.message}`);
    clearCache("students");
    await syncAdminData(`${eligible.length} aluno(s) marcado(s) como formados.`);
  });

  $$("[data-student-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      adminEditState.studentId = button.dataset.id;
      renderAdminContent();
    })
  );

  $$("[data-student-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await deleteStudent(state.students.find((student) => idsEqual(student.id, button.dataset.id)));
    })
  );

  $$('[data-student-diploma]').forEach((button) => button.addEventListener("click", () => generateGraduationDocument(state.students.find((student) => idsEqual(student.id, button.dataset.id)), "diploma")));
  $$('[data-student-history]').forEach((button) => button.addEventListener("click", () => generateGraduationDocument(state.students.find((student) => idsEqual(student.id, button.dataset.id)), "history")));

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

function renderDirectorAdmin(content) {
  const checklistToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const reportToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const weekday = new Date().getDay();
  const checklistTracking = state.sectorChecklists.filter((item) => item.active !== false && (Array.isArray(item.weekdays) ? item.weekdays : [0,1,2,3,4,5,6]).includes(weekday)).flatMap((checklist) => {
    const items = state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, checklist.id));
    return state.sectorChecklistAssignees.filter((assignee) => idsEqual(assignee.checklist_id, checklist.id)).map((assignee) => {
      const done = state.sectorChecklistCompletions.filter((entry) => idsEqual(entry.checklist_id, checklist.id) && idsEqual(entry.user_id, assignee.user_id) && entry.user_role === assignee.user_role && entry.completed && entry.completed_on === checklistToday).length;
      const person = assignee.user_role === "teacher" ? state.teachers.find((item) => idsEqual(item.id, assignee.user_id)) : state.staff.find((item) => idsEqual(item.id, assignee.user_id));
      return { checklist, items, done, person };
    });
  });
  const activeTasks = state.workTasks.filter((task) => task.status === "published");
  const assignments = state.workTaskAssignees.filter((item) => activeTasks.some((task) => idsEqual(task.id, item.task_id)));
  const completed = assignments.filter((item) => item.status === "completed");
  const pending = assignments.filter((item) => item.status !== "completed");
  const overdue = pending.filter((item) => {
    const task = activeTasks.find((value) => idsEqual(value.id, item.task_id));
    return task?.due_at && new Date(task.due_at) < new Date();
  });
  const pendingNotices = state.notifications.filter((item) => item.recipient_role === "all_admins" || item.recipient_role === "all_school").slice(-6).reverse();
  const renderChecklistPerformance = (period, referenceDate) => {
    const range = dateRangeForPeriod(period, referenceDate);
    const periodDates = [];
    const cursor = new Date(`${range.start}T12:00:00`);
    const lastDate = new Date(`${range.end}T12:00:00`);
    while (cursor <= lastDate) {
      periodDates.push({ key: dateKeyForDate(cursor), weekday: cursor.getDay() });
      cursor.setDate(cursor.getDate() + 1);
    }

    const people = new Map();
    state.sectorChecklists.filter((item) => item.active !== false).forEach((checklist) => {
      const items = state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, checklist.id));
      if (!items.length) return;
      const scheduledDays = Array.isArray(checklist.weekdays) ? checklist.weekdays : [0, 1, 2, 3, 4, 5, 6];
      const createdDate = schoolDateKey(checklist.created_at);
      const dates = periodDates.filter((date) => scheduledDays.includes(date.weekday) && (!createdDate || date.key >= createdDate));
      if (!dates.length) return;
      const assignedPeople = state.sectorChecklistAssignees.filter((item) => idsEqual(item.checklist_id, checklist.id));
      const checklistPeople = assignedPeople.length
        ? assignedPeople
        : checklist.sector === "professores"
          ? state.teachers.map((person) => ({ user_role: "teacher", user_id: person.id }))
          : checklist.sector === "alunos"
            ? []
            : state.staff.filter((person) => person.sector === checklist.sector).map((person) => ({ user_role: "staff", user_id: person.id }));
      const itemIds = new Set(items.map((item) => String(item.id)));
      const dateKeys = new Set(dates.map((date) => date.key));
      checklistPeople.forEach((assignment) => {
        const key = `${assignment.user_role}:${assignment.user_id}`;
        if (!people.has(key)) {
          const person = assignment.user_role === "teacher"
            ? state.teachers.find((item) => idsEqual(item.id, assignment.user_id))
            : state.staff.find((item) => idsEqual(item.id, assignment.user_id));
          people.set(key, {
            name: person?.name || "Funcionário não encontrado",
            role: assignment.user_role === "teacher" ? "Professor(a)" : (sectorLabels[person?.sector] || person?.sector || "Funcionário"),
            expected: 0,
            completed: new Set()
          });
        }
        const reportPerson = people.get(key);
        reportPerson.expected += items.length * dates.length;
        state.sectorChecklistCompletions.forEach((completion) => {
          if (
            completion.completed &&
            idsEqual(completion.checklist_id, checklist.id) &&
            idsEqual(completion.user_id, assignment.user_id) &&
            completion.user_role === assignment.user_role &&
            itemIds.has(String(completion.item_id)) &&
            dateKeys.has(completion.completed_on)
          ) {
            reportPerson.completed.add(`${completion.completed_on}:${completion.item_id}`);
          }
        });
      });
    });

    const rows = [...people.values()]
      .filter((person) => person.expected > 0)
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .map((person) => {
        const done = Math.min(person.completed.size, person.expected);
        const percent = Math.round((done / person.expected) * 100);
        return `<tr><td data-label="Funcionário">${escapeHtml(person.name)}</td><td data-label="Setor/função">${escapeHtml(person.role)}</td><td data-label="Concluídos">${done}</td><td data-label="Previstos">${person.expected}</td><td data-label="Desempenho"><strong>${percent}%</strong></td></tr>`;
      });
    const labelDate = (value) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${value}T12:00:00`));
    const periodLabel = range.start === range.end ? labelDate(range.start) : `${labelDate(range.start)} a ${labelDate(range.end)}`;
    return `<p class="muted">Período: ${periodLabel}</p><div class="table-scroll"><table class="report-table checklist-performance-table"><thead><tr><th>Funcionário</th><th>Setor/função</th><th>Concluídos</th><th>Previstos</th><th>Desempenho</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="5">Não há checklists escalados para este período.</td></tr>`}</tbody></table></div>`;
  };
  content.innerHTML = `
    <div class="director-shell">
      <div class="director-hero"><div><span>Painel de gestão</span><h2>Diretor</h2><p>Acompanhe checklists e pendências da equipe em um só lugar.</p></div><button class="button primary" type="button" data-director-notifications>Ver avisos</button></div>
      <div class="director-kpis">
        ${miniStat("Checklists concluídos", completed.length)}
        ${miniStat("Checklists pendentes", pending.length)}
        ${miniStat("Vencidos", overdue.length)}
      </div>
      <section class="panel director-report"><div class="portal-heading compact"><div><h3>Relatório de desempenho dos funcionários</h3><p class="muted">Compare itens concluídos com os checklists previstos para cada pessoa.</p></div></div><div class="support-filters"><label>Período<select class="input" data-checklist-report-period><option value="day">Dia</option><option value="week">Semana</option><option value="month" selected>Mês</option><option value="year">Ano</option></select></label><label>Data de referência<input class="input" type="date" data-checklist-report-date value="${reportToday}"></label></div><div data-checklist-performance-results>${renderChecklistPerformance("month", reportToday)}</div></section>
      <div class="director-grid">
        <section class="panel"><div class="portal-heading compact"><div><h3>Checklists de hoje</h3><p class="muted">Acompanhamento por local e responsável.</p></div></div><div class="list-view">${checklistTracking.map(({ checklist, items, done, person }) => `<article class="list-item director-row"><div><strong>${escapeHtml(checklist.title)}</strong><p class="muted">${escapeHtml(checklist.location || checklist.sector)} · ${escapeHtml(person?.name || "Responsável")}</p></div><span class="badge ${items.length && done === items.length ? "success" : "warning"}">${items.length && done === items.length ? "Concluído" : `${done}/${items.length} itens`}</span></article>`).join("") || emptyState("Não há checklists escalados para hoje.")}</div></section>
        <section class="panel"><div class="portal-heading compact"><div><h3>Checklists da equipe</h3><p class="muted">Acompanhe as tarefas distribuídas para a equipe.</p></div></div><div class="list-view">${pending.map((assignment) => { const task = activeTasks.find((item) => idsEqual(item.id, assignment.task_id)); const isOverdue = task?.due_at && new Date(task.due_at) < new Date(); return `<article class="list-item director-row"><div><strong>${escapeHtml(task?.title || "Checklist")}</strong></div><span class="badge ${isOverdue ? "warning" : ""}">${isOverdue ? "Vencido" : "Não concluído"}</span></article>`; }).join("") || emptyState("Todos os checklists distribuídos foram concluídos.")}</div></section>
      </div>
      <section class="panel"><div class="portal-heading compact"><div><h3>Criar checklist por setor</h3><p class="muted">Ele aparecerá automaticamente no painel do setor selecionado.</p></div></div><form class="contact-form" data-sector-checklist-form><label>Setor<select class="input" name="sector" required>${buildOptions(Object.entries(sectorLabels).map(([value, label]) => ({ value, label })))}</select></label><label>Título<input class="input" name="title" required></label><label>Orientação<textarea class="input" name="description" rows="2"></textarea></label><label>Itens (um por linha)<textarea class="input" name="items" rows="5" required></textarea></label><button class="button primary">Publicar checklist</button></form><div class="list-view">${state.sectorChecklists.map((checklist) => `<article class="list-item"><div><strong>${escapeHtml(checklist.title)}</strong><p class="muted">${escapeHtml(sectorLabels[checklist.sector] || checklist.sector)} · ${state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, checklist.id)).length} item(ns)</p></div><button class="button ghost" type="button" data-sector-checklist-delete="${escapeHtml(checklist.id)}">Excluir</button></article>`).join("") || emptyState("Nenhum checklist publicado.")}</div></section>
      <section class="panel" data-director-notification-panel hidden><div class="portal-heading compact"><h3>Notificações da direção</h3><button class="button ghost" data-director-notifications>Fechar</button></div><div class="list-view">${pendingNotices.map((item) => `<article class="list-item"><div><strong>${escapeHtml(item.title)}</strong><p class="muted">${escapeHtml(item.message)}</p></div></article>`).join("") || emptyState("Nenhuma notificação pendente.")}</div></section>
    </div>`;
  $$('[data-director-notifications]').forEach((button) => button.addEventListener("click", () => { const panel = $(`[data-director-notification-panel]`); if (panel) panel.hidden = !panel.hidden; }));
  const updateChecklistReport = () => {
    const period = $("[data-checklist-report-period]", content).value;
    const referenceDate = $("[data-checklist-report-date]", content).value;
    $("[data-checklist-performance-results]", content).innerHTML = renderChecklistPerformance(period, referenceDate);
  };
  $$("[data-checklist-report-period], [data-checklist-report-date]", content).forEach((input) => input.addEventListener("change", updateChecklistReport));
  const editingChecklist = state.sectorChecklists.find((item) => idsEqual(item.id, editingSectorChecklistId));
  const checklistPeople = [
    ...state.teachers.map((person) => ({ id: person.id, role: "teacher", name: person.name, sector: "professores" })),
    ...state.staff.map((person) => ({ id: person.id, role: "staff", name: person.name, sector: person.sector }))
  ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const selectedPeople = new Set(state.sectorChecklistAssignees.filter((item) => editingChecklist && idsEqual(item.checklist_id, editingChecklist.id)).map((item) => `${item.user_role}:${item.user_id}`));
  const selectedDays = new Set(editingChecklist?.weekdays || [1, 2, 3, 4, 5]);
  const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const editor = $("[data-sector-checklist-form]");
  if (editor) editor.outerHTML = `<form class="contact-form" data-sector-checklist-form><input type="hidden" name="id" value="${escapeHtml(editingChecklist?.id || "")}"><label>Setor / destino<select class="input" name="sector" required>${buildOptions(Object.entries(sectorLabels).map(([value, label]) => ({ value, label })), editingChecklist?.sector || "")}</select></label><label>Local onde será usado<input class="input" name="location" value="${escapeHtml(editingChecklist?.location || "")}" placeholder="Ex.: Limpeza — sala 3A" required></label><label>Título do checklist<input class="input" name="title" value="${escapeHtml(editingChecklist?.title || "")}" placeholder="Ex.: Limpeza da sala 3A" required></label><label>Orientação<textarea class="input" name="description" rows="2">${escapeHtml(editingChecklist?.description || "")}</textarea></label><fieldset class="checklist-schedule"><legend>Dias em que deve aparecer</legend>${dayLabels.map((day, index) => `<label><input type="checkbox" name="weekdays" value="${index}" ${selectedDays.has(index) ? "checked" : ""}> ${day}</label>`).join("")}</fieldset><fieldset class="checklist-assignees"><legend>Quem vai preencher</legend><p class="muted">Selecione as pessoas da escala. O checklist só aparece para elas, nos dias definidos.</p><div>${checklistPeople.map((person) => `<label><input type="checkbox" name="assignees" value="${person.role}:${escapeHtml(person.id)}" ${selectedPeople.has(`${person.role}:${person.id}`) ? "checked" : ""}> <span>${escapeHtml(person.name)}</span><small>${escapeHtml(sectorLabels[person.sector] || person.sector)}</small></label>`).join("") || "<p class=\"muted\">Cadastre professores ou funcionários para selecionar responsáveis.</p>"}</div></fieldset><label>Itens (um por linha)<textarea class="input" name="items" rows="5" required>${escapeHtml(editingChecklist ? state.sectorChecklistItems.filter((item) => idsEqual(item.checklist_id, editingChecklist.id)).sort((a,b) => Number(a.position) - Number(b.position)).map((item) => item.label).join("\n") : "")}</textarea></label><div class="row-actions"><button class="button primary">${editingChecklist ? "Salvar alterações" : "Publicar checklist"}</button>${editingChecklist ? '<button class="button ghost" type="button" data-sector-checklist-cancel>Cancelar edição</button>' : ""}</div></form>`;
  $$('[data-sector-checklist-delete]').forEach((button) => button.insertAdjacentHTML("beforebegin", `<button class="button ghost" type="button" data-sector-checklist-edit="${escapeHtml(button.dataset.sectorChecklistDelete)}">Editar</button>`));
  $("[data-sector-checklist-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target);
    const labels = String(form.get("items") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!labels.length) return toast("Informe ao menos um item.");
    const id = String(form.get("id") || "");
    const payload = { sector: form.get("sector"), location: String(form.get("location") || "").trim(), title: String(form.get("title")).trim(), description: String(form.get("description") || "").trim(), weekdays: form.getAll("weekdays").map(Number), created_by: String(getSession()?.id || "direcao") };
    if (!payload.location || !payload.weekdays.length) return toast("Informe o local e ao menos um dia da escala.");
    const result = id ? await supabase.from("sector_checklists").update(payload).eq("id", id).select().single() : await supabase.from("sector_checklists").insert(payload).select().single();
    const { data: checklist, error } = result;
    if (error) return toast("Não foi possível criar o checklist. Execute a migração do Supabase.");
    if (id) { await supabase.from("sector_checklist_items").delete().eq("checklist_id", id); await supabase.from("sector_checklist_assignees").delete().eq("checklist_id", id); }
    const { error: itemsError } = await supabase.from("sector_checklist_items").insert(labels.map((label, position) => ({ checklist_id: checklist.id, label, position })));
    if (itemsError) return toast("Checklist criado, mas os itens não puderam ser salvos.");
    const assignees = form.getAll("assignees").map((value) => { const [user_role, user_id] = String(value).split(":"); return { checklist_id: checklist.id, user_id, user_role }; });
    if (assignees.length) { const { error: assigneeError } = await supabase.from("sector_checklist_assignees").insert(assignees); if (assigneeError) return toast("Checklist salvo, mas falhou ao salvar os responsáveis."); }
    editingSectorChecklistId = null; clearCache("sector_checklists"); clearCache("sector_checklist_items"); clearCache("sector_checklist_assignees"); await loadDataFromSupabase({ forceNetwork: true }); toast(id ? "Checklist atualizado." : "Checklist publicado."); renderDirectorAdmin(content);
  });
  $("[data-sector-checklist-cancel]")?.addEventListener("click", () => { editingSectorChecklistId = null; renderDirectorAdmin(content); });
  $$('[data-sector-checklist-edit]').forEach((button) => button.addEventListener("click", () => { editingSectorChecklistId = button.dataset.sectorChecklistEdit; renderDirectorAdmin(content); }));
  $$('[data-sector-checklist-delete]').forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Excluir este checklist e seus itens?")) return;
    const { error } = await supabase.from("sector_checklists").delete().eq("id", button.dataset.sectorChecklistDelete);
    if (error) return toast("Não foi possível excluir o checklist.");
    clearCache("sector_checklists"); await loadDataFromSupabase({ forceNetwork: true }); renderDirectorAdmin(content);
  }));
}

function renderStaffAdmin(content) {
  content.innerHTML = `
    <div class="portal-heading"><div><h2>Funcionários</h2><p class="muted">Crie e gerencie os acessos internos da escola.</p></div></div>
    <div class="grade-grid">
      <form class="panel contact-form" data-staff-form><h3>Criar acesso de funcionário</h3><label>Nome<input class="input" name="name" required></label><label>Setor<select class="input" name="sector" required>${buildOptions(Object.entries(sectorLabels).map(([value, label]) => ({ value, label })))}</select></label><label>Usuário<input class="input" name="user" required></label><label>Senha inicial<input class="input" name="password" type="text" value="1234" required></label><button class="button primary">Criar login</button></form>
      <form class="panel contact-form" data-notification-form><h3>Enviar aviso</h3><label>Tipo de destinatário<select class="input" name="recipient" required><option value="all_staff">Funcionários</option><option value="all_students">Alunos</option><option value="all_teachers">Professores</option><option value="all_school">Toda a escola</option>${state.staff.map((employee) => `<option value="${escapeHtml(employee.id)}">Funcionário: ${escapeHtml(employee.name)}</option>`).join("")}</select></label><label>Título<input class="input" name="title" required></label><label>Mensagem<textarea class="input" name="message" rows="4" required></textarea></label><button class="button primary">Enviar aviso</button></form>
    </div>
    <section class="panel"><h3>Acessos criados</h3><div class="list-view">${state.staff.map((employee) => `<article class="list-item admin-record"><div><strong>${escapeHtml(employee.name)}</strong><p class="muted">${escapeHtml(sectorLabels[employee.sector] || employee.sector)} · usuário: @${escapeHtml(employee.user)}</p></div><button class="button ghost" type="button" data-staff-delete data-id="${escapeHtml(employee.id)}">Excluir</button></article>`).join("") || emptyState("Nenhum funcionário cadastrado.")}</div></section>`;
  $("[data-notification-form]")?.remove();
  $("[data-staff-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const user = normalizeUser(form.get("user"));
    if (!user || getExistingUsernames().has(user) || state.staff.some((item) => normalizeUser(item.user) === user)) return toast("Escolha um usuário único.");
    await upsertRecord("staff", { name: String(form.get("name")).trim(), sector: form.get("sector"), user, password: normalizePassword(form.get("password")) }, "id", "Login de funcionário criado.");
  });
  $("[data-notification-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const recipient = String(form.get("recipient"));
    const employee = state.staff.find((item) => idsEqual(item.id, recipient));
    await upsertRecord("private_notifications", { title: String(form.get("title")).trim(), message: String(form.get("message")).trim(), recipient_id: employee?.id || null, recipient_role: recipient === "all_staff" ? "all_staff" : null, recipient_sector: employee?.sector || null }, "id", "Aviso enviado ao painel selecionado.");
  });
  $$('[data-staff-delete]').forEach((button) => button.addEventListener("click", () => deleteRecord("staff", "id", button.dataset.id, "Acesso removido.")));
}

function renderNotificationsAdmin(content) {
  const recipients = [
    { value: "all_students", label: "Alunos" },
    { value: "all_teachers", label: "Professores" },
    { value: "sector:secretaria", label: "Secretaria Escolar" },
    { value: "sector:cozinha", label: "Merendeiras / Cozinha" },
    { value: "sector:servicos_gerais", label: "Serviços Gerais e Manutenção" },
    { value: "all_staff", label: "Outros funcionários / todos" },
    { value: "all_school", label: "Toda a escola" }
  ];
  content.innerHTML = `<div class="portal-heading"><div><h2>Painel de avisos</h2><p class="muted">Os avisos só são vistos quando a pessoa clica no sino do próprio painel.</p></div></div><form class="panel contact-form" data-notification-center-form><label>Enviar para<select class="input" name="recipient" required>${buildOptions(recipients)}</select></label><label>Título<input class="input" name="title" required></label><label>Mensagem<textarea class="input" name="message" rows="5" required></textarea></label><button class="button primary">Enviar notificação</button></form><section class="panel"><h3>Últimos avisos</h3><div class="list-view">${state.notifications.slice().sort((a,b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).map((item) => `<article class="list-item"><div><strong>${escapeHtml(item.title)}</strong><p class="muted">${escapeHtml(item.message)}</p></div></article>`).join("") || emptyState("Nenhum aviso enviado.")}</div></section>`;
  $("[data-notification-center-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.target); const recipient = String(form.get("recipient"));
    const sector = recipient.startsWith("sector:") ? recipient.slice(7) : null;
    const role = sector ? null : recipient;
    await upsertRecord("private_notifications", { title: String(form.get("title")).trim(), message: String(form.get("message")).trim(), recipient_role: role, recipient_sector: sector }, "id", "Notificação enviada.");
  });
}

function renderKitchenAdmin(content) {
  content.innerHTML = `<div class="portal-heading"><div><h2>Gestão da cozinha</h2><p class="muted">Publique o cardápio, estoque e restrições alimentares.</p></div></div><div class="grade-grid">
  <form class="panel contact-form" data-menu-form><h3>Cardápio nutricional</h3><label>Data<input class="input" name="menu_date" type="date" required></label><label>Refeição / cardápio<input class="input" name="meal" required></label><label>Ingredientes para baixa<textarea class="input" name="ingredients" rows="3" placeholder="Arroz: 2; Feijão: 1" required></textarea></label><small class="muted">Use nome: quantidade, separados por ponto e vírgula. Os nomes devem coincidir com o estoque.</small><button class="button primary">Publicar cardápio</button></form>
  <form class="panel contact-form" data-stock-form><h3>Adicionar ao estoque</h3><label>Item<input class="input" name="name" required></label><label>Quantidade<input class="input" name="quantity" type="number" step="0.01" required></label><label>Unidade<input class="input" name="unit" placeholder="kg, L, unidades"></label><label>Estoque mínimo<input class="input" name="minimum_quantity" type="number" step="0.01" required></label><label>Validade<input class="input" name="expiry_date" type="date"></label><button class="button primary">Salvar item</button></form>
  <form class="panel contact-form" data-restriction-form><h3>Restrição alimentar</h3><label>Aluno e turma<select class="input" name="student_id" required><option value="">Selecione o aluno</option>${state.students.map((student) => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name)} — ${escapeHtml(getClassLabel(student.className))}</option>`).join("")}</select></label><label>Restrição / orientação<textarea class="input" name="restriction" rows="3" required></textarea></label><button class="button primary">Adicionar restrição</button></form></div>`;
  const save = (selector, table, fields, message) => $(selector).addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.target); const payload = Object.fromEntries(fields.map((field) => [field, String(form.get(field) || "").trim()])); const saved = await upsertRecord(table, payload, "id", message); if (saved && table === "kitchen_stock" && Number(saved.quantity) <= Number(saved.minimum_quantity)) await upsertRecord("private_notifications", { title: "Estoque mínimo", message: `${saved.name} atingiu o estoque mínimo.`, recipient_sector: "cozinha" }, "id", "", { skipPortalRender: true }); if (saved) event.target.reset(); });
  save("[data-menu-form]", "kitchen_menu", ["menu_date", "meal", "ingredients"], "Cardápio publicado.");
  save("[data-stock-form]", "kitchen_stock", ["name", "quantity", "unit", "minimum_quantity", "expiry_date"], "Estoque atualizado.");
  $("[data-restriction-form]").addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.target); const student = state.students.find((item) => idsEqual(item.id, form.get("student_id"))); if (!student) return toast("Selecione um aluno."); const saved = await upsertRecord("dietary_restrictions", { student_id: student.id, student_name: student.name, class_name: getClassLabel(student.className), restriction: String(form.get("restriction")).trim() }, "id", "Restrição cadastrada."); if (saved) event.target.reset(); });
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
          sortPeopleByName(state.teachers)
            .map(
              (teacher) => `
                <article class="list-item admin-record">
                  <div>
                    <strong>${escapeHtml(teacher.name)}</strong>
                    <p class="muted">Usuário: ${teacher.user ? `@${escapeHtml(teacher.user)}` : "não definido"}</p>
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
      ...(id ? { id } : {}),
      name: String(form.get("name") || "").trim(),
      subject: subjects.join(", "),
      classes,
      user: createStudentUsername(String(form.get("name") || ""), getExistingUsernames(id), String(form.get("user") || "")),
      password: password || null
    };
    if (!payload.name || !assignments.length) return toast("Informe o nome e vincule ao menos uma disciplina a uma turma.");
    const saved = await upsertRecord("teachers", payload, "id", id ? "Professor atualizado." : "Professor salvo.");
    if (!saved) return;
    try {
      await replaceTeacherAssignments(saved.id, assignments);
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
  const editing = adminEditState.gradeId ? state.grades.find((item) => idsEqual(item.id, adminEditState.gradeId)) : null;
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
      ...(id ? { id } : {}),
      studentId: String(form.get("studentId") || "").trim(),
      subject: String(form.get("subject") || "").trim(),
      className: String(form.get("classname") || "").trim(),
      trimesters: trimesters
    };
    if (!payload.studentId || !payload.subject || !payload.className) return toast("Preencha todos os campos.");
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
      ${type === "news" || type === "events" || type === "activities" || type === "achievements" ? `
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
    // Ao criar, o banco define o ID. Isso é compatível tanto com UUIDs quanto
    // com instalações antigas que usam identidade numérica.
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
        location: String(form.get("location") || "").trim(),
        files: selectedFiles
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
        category: String(form.get("category") || "").trim(),
        files: selectedFiles
      };
    }

    if ((type === "news" || type === "events") && !payload.title) return toast(`Informe o título da ${titleLabel.toLowerCase()}.`);
    if ((type === "activities" || type === "achievements") && !((payload.name || payload.title) || "")) {
      return toast(`Informe o nome ou título da ${titleLabel.toLowerCase()}.`);
    }

    const table = type;
    const saved = await upsertRecord(table, payload, "id", id ? `${titleLabel} atualizado.` : `${titleLabel} salvo.`, { skipPortalRender: true });
    if (saved) {
      if (type === "events" && !id) {
        await upsertRecord("private_notifications", {
          title: `Evento: ${payload.title}`,
          message: `${payload.date}${payload.time ? ` às ${payload.time}` : ""}${payload.location ? ` · ${payload.location}` : ""}${payload.description ? ` — ${payload.description}` : ""}`,
          recipient_role: "all_school"
        }, "id", "Evento salvo e aviso enviado.", { skipPortalRender: true });
      }
      adminEditState.contentId = null;
      renderAdminContent();
    }
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
      ${renderFixedGradeInput(recoveryScore, `rec-${student.id}`, "recoveryScore", `Nota de recuperação de ${student.name}`, {
        recovery: true,
        disabled: regularAverage >= 6 && !recoveryScore
      })}
    </div>
  `;
}

function renderFixedGradeInput(score, name, field, label, { recovery = false, disabled = false } = {}) {
  const numericScore = Number(score);
  const hasScore = Number.isFinite(numericScore) && numericScore > 0;
  const value = hasScore ? numericScore.toFixed(1) : "";
  return `<div class="grade-score-input">
    <input class="input" type="text" inputmode="decimal" maxlength="4" placeholder="0.0" data-score-entry data-score-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}" value="${value}" ${disabled ? "disabled" : ""}>
    <input type="hidden" name="${escapeHtml(name)}" data-score-input="${escapeHtml(field)}" value="${value}" ${recovery ? "data-recovery-input" : ""}>
  </div>`;
}

function teacherStudentRow(student, teacher, trimester, subject, className) {
  const grade = state.grades.find(
    (g) =>
      idsEqual(g.studentId, student.id) &&
      sameSubjectLabel(g.subject, subject) &&
      sameClassLabel(g.className, className)
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
      <label class="grade-input-cell" data-label="N1">${renderFixedGradeInput(trimesterData.n1, `n1-${student.id}`, "n1", `Nota 1 de ${student.name}`)}</label>
      <label class="grade-input-cell" data-label="N2">${renderFixedGradeInput(trimesterData.n2, `n2-${student.id}`, "n2", `Nota 2 de ${student.name}`)}</label>
      <label class="grade-input-cell" data-label="N3">${renderFixedGradeInput(trimesterData.n3, `n3-${student.id}`, "n3", `Nota 3 de ${student.name}`)}</label>
      <strong class="grade-value-cell" data-label="Media" data-average>${average}</strong>
      <div class="grade-value-cell" data-label="Recuperação" data-recovery-cell>${renderRecoveryCell(grade, trimester, student)}</div>
      <span class="grade-value-cell badge ${approved ? "success" : "warning"}" data-label="Situacao" data-status>${statusText}</span>
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
        sameSubjectLabel(g.subject, subject) &&
        sameClassLabel(g.className, className)
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
      if (recoveryCell) {
        const nextRecoveryMarkup = renderRecoveryCell(snapshot, trimester, student);
        const recoveryInput = recoveryCell.querySelector('[data-recovery-input]');
        const needsRecoveryInput = nextRecoveryMarkup.includes("data-recovery-input");
        if (needsRecoveryInput !== Boolean(recoveryInput)) {
          recoveryCell.innerHTML = nextRecoveryMarkup;
          bindFixedGradeInputs(row, updateRow);
        } else if (recoveryInput) {
          const regularAverage = getTrimesterRegularAverage(snapshot, trimester);
          const recoveryScore = getTrimesterRecoveryScore(snapshot, trimester);
          recoveryInput.disabled = regularAverage >= 6 && !recoveryScore;
        }
      }
    };

    bindFixedGradeInputs(row, updateRow);

    updateRow();
  });
}

function formatFixedGradeDigits(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 3);
  if (!digits) return "";
  if (digits.length === 1) return digits;
  return `${digits.slice(0, -1)}.${digits.slice(-1)}`;
}

function formatExplicitGradeScore(value) {
  const normalized = String(value || "").replace(",", ".");
  const separator = normalized.indexOf(".");
  if (separator < 0) return formatFixedGradeDigits(normalized);
  const whole = normalized.slice(0, separator).replace(/\D/g, "").slice(0, 2) || "0";
  const decimal = normalized.slice(separator + 1).replace(/\D/g, "").slice(0, 1);
  return `${whole}.${decimal}`;
}

function canonicalGradeScore(value) {
  if (!value) return "";
  if (value.endsWith(".")) return `${value}0`;
  if (!value.includes(".")) return `${value}.0`;
  return value;
}

function bindFixedGradeInputs(row, updateRow) {
  row.querySelectorAll("[data-score-entry]").forEach((input) => {
    if (input.dataset.scoreBound) return;
    input.dataset.scoreBound = "true";
    input.addEventListener("focus", () => {
      input.dataset.scoreMode = "digits";
      input.dataset.scoreDigits = "";
      input.select();
    });
    input.addEventListener("input", (event) => {
      const mode = input.dataset.scoreMode || "digits";
      let displayValue;
      if (mode === "digits" && /^\d$/.test(event.data || "")) {
        input.dataset.scoreDigits = `${input.dataset.scoreDigits || ""}${event.data}`.slice(0, 3);
        displayValue = formatFixedGradeDigits(input.dataset.scoreDigits);
      } else if (mode === "digits" && (event.data === "." || event.data === ",")) {
        input.dataset.scoreMode = "explicit";
        displayValue = formatExplicitGradeScore(input.value);
      } else if (mode === "digits" && event.inputType?.startsWith("delete")) {
        input.dataset.scoreDigits = input.value.replace(/\D/g, "").slice(0, 3);
        displayValue = formatFixedGradeDigits(input.dataset.scoreDigits);
      } else {
        const previousDisplay = formatFixedGradeDigits(input.dataset.scoreDigits || "");
        const enteredSeparator = input.value === `${previousDisplay}.` ||
          input.value === `${previousDisplay},` ||
          (event.inputType === "insertFromPaste" && /[.,]/.test(input.value));
        if (mode === "digits" && enteredSeparator) input.dataset.scoreMode = "explicit";
        if (input.dataset.scoreMode === "explicit") {
          displayValue = formatExplicitGradeScore(input.value);
        } else {
          input.dataset.scoreDigits = input.value.replace(/\D/g, "").slice(0, 3);
          displayValue = formatFixedGradeDigits(input.dataset.scoreDigits);
        }
      }

      input.value = displayValue;
      const field = input.dataset.scoreField;
      const valueInput = row.querySelector(`[data-score-input="${field}"]`);
      if (valueInput) valueInput.value = canonicalGradeScore(displayValue);
      updateRow();
    });
    input.addEventListener("blur", () => {
      const displayValue = input.dataset.scoreMode === "explicit"
        ? formatExplicitGradeScore(input.value)
        : formatFixedGradeDigits(input.dataset.scoreDigits || input.value);
      const canonicalValue = canonicalGradeScore(displayValue);
      input.value = canonicalValue;
      const valueInput = row.querySelector(`[data-score-input="${input.dataset.scoreField}"]`);
      if (valueInput) valueInput.value = canonicalValue;
      updateRow();
    });
  });
}

function teacherReportTable(teacher, grades, subject, className) {
  const rows = sortGradesByStudentName(grades)
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
      const hasAnyScore = ["1", "2", "3"].some((trimester) => hasTrimesterScores(grade, trimester));
      const scoreClass = (value, wasLaunched) => wasLaunched && Number(value) < 6 ? "score-low" : "";
      return `
        <tr>
          <td>${escapeHtml(student?.name || "Aluno")}</td>
          <td>${escapeHtml(getClassLabel(grade.className))}</td>
          <td class="${scoreClass(t1Final, hasTrimesterScores(grade, "1"))}">${t1Final}</td>
          <td class="${scoreClass(t2Final, hasTrimesterScores(grade, "2"))}">${t2Final}</td>
          <td class="${scoreClass(t3Final, hasTrimesterScores(grade, "3"))}">${t3Final}</td>
          <td class="${scoreClass(gradeAverage(grade), hasAnyScore)}">${gradeAverage(grade)}</td>
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

function teacherPdfReportTable(grades, subject, className) {
  const score = (grade, trimester, field) => {
    const value = Number(getTrimester(grade, trimester)[field] || 0);
    return `<td class="${hasLaunchedScore(grade, trimester, field) && value < 6 ? "low-score" : ""}">${value.toFixed(1)}</td>`;
  };
  const rows = sortGradesByStudentName(grades).map((grade, index) => {
    const student = state.students.find((item) => idsEqual(item.id, grade.studentId));
    const finalAverage = gradeAverage(grade);
    const status = hasTrimesterScores(grade, "3")
      ? Number(finalAverage) >= 6 ? "Aprovado" : "Recuperação final"
      : "Em andamento";
    const averageCell = (value, wasLaunched) => `<td class="average ${wasLaunched && Number(value) < 6 ? "low-score" : ""}">${value}</td>`;
    const hasAnyScore = ["1", "2", "3"].some((trimester) => hasTrimesterScores(grade, trimester));
    return `<tr><td>${index + 1}</td><td class="student-name">${escapeHtml(student?.name || "Aluno")}</td>${["1", "2", "3"].map((trimester) => `${score(grade, trimester, "n1")}${score(grade, trimester, "n2")}${score(grade, trimester, "n3")}${averageCell(getTrimesterFinalAverage(grade, trimester), hasTrimesterScores(grade, trimester))}`).join("")}${averageCell(finalAverage, hasAnyScore)}<td>${status}</td></tr>`;
  }).join("");
  return `<section class="official-report"><table class="grade-sheet"><thead><tr><th rowspan="2">Nº</th><th rowspan="2">Estudante</th><th colspan="4">1º trimestre</th><th colspan="4">2º trimestre</th><th colspan="4">3º trimestre</th><th rowspan="2">Média anual</th><th rowspan="2">Situação</th></tr><tr>${["1", "2", "3"].map(() => "<th>N1</th><th>N2</th><th>N3</th><th>MF</th>").join("")}</tr></thead><tbody>${rows || `<tr><td colspan="16">Nenhuma nota registrada nesta turma e disciplina.</td></tr>`}</tbody></table><p class="legend">N1, N2 e N3: notas trimestrais. MF: média final do trimestre. RF: resultado final.</p></section>`;
}

function studentPdfReportTable(subjectEntries, allComplete, finalRecovery) {
  const scoreCell = (grade, trimester, field) => {
    const value = Number(getTrimester(grade, trimester)[field] || 0);
    const scoreWasLaunched = hasLaunchedScore(grade, trimester, field);
    return `<td class="${scoreWasLaunched && value < 6 ? "low-score" : ""}">${value.toFixed(1)}</td>`;
  };
  const averageCell = (value, hasLaunchedScore) => `<td class="average ${hasLaunchedScore && Number(value) < 6 ? "low-score" : ""}">${value}</td>`;
  const rows = subjectEntries.map(({ subject, grade }) => {
    const data = grade || { trimesters: {} };
    const status = !grade ? "Sem notas" : allComplete ? Number(gradeAverage(data)) >= 6 ? "Aprovado" : finalRecovery ? "Recuperação final" : "Recuperação" : "Em andamento";
    const trimesterCells = ["1", "2", "3"].map((trimester) => `${scoreCell(data, trimester, "n1")}${scoreCell(data, trimester, "n2")}${scoreCell(data, trimester, "n3")}${averageCell(getTrimesterFinalAverage(data, trimester), hasTrimesterScores(data, trimester))}`).join("");
    return `<tr><td class="student-name">${escapeHtml(subject)}</td>${trimesterCells}${averageCell(gradeAverage(data), ["1", "2", "3"].some((trimester) => hasTrimesterScores(data, trimester)))}<td>${status}</td></tr>`;
  }).join("");
  return `<section class="official-report"><table class="grade-sheet student-sheet"><thead><tr><th rowspan="2">Disciplina</th><th colspan="4">1º trimestre</th><th colspan="4">2º trimestre</th><th colspan="4">3º trimestre</th><th rowspan="2">Média anual</th><th rowspan="2">Situação</th></tr><tr>${["1", "2", "3"].map(() => "<th>Nota 1</th><th>Nota 2</th><th>Nota 3</th><th>Média</th>").join("")}</tr></thead><tbody>${rows || `<tr><td colspan="15">Nenhuma disciplina vinculada.</td></tr>`}</tbody></table><p class="legend">Cada trimestre apresenta as três notas lançadas e a respectiva média. Notas e médias abaixo de 6,0 aparecem em vermelho.</p></section>`;
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

function publicSupportRequesterId() {
  const key = "ceti-public-support-requester";
  let requesterId = localStorage.getItem(key);
  if (!requesterId) {
    requesterId = `public:${makeId()}`;
    localStorage.setItem(key, requesterId);
  }
  return requesterId;
}

function renderPublicSupportChat() {
  const content = $("[data-public-chat-content]");
  const requesterId = publicSupportRequesterId();
  const request = activeSupportRequest(requesterId);
  if (request) {
    if (!supportMessagesLoaded) {
      content.innerHTML = `<p class="muted">Carregando conversa...</p>`;
      void ensureSupportMessagesLoaded(request.id).then(renderPublicSupportChat).catch((error) => {
        console.error("Erro ao carregar mensagens do atendimento público:", error);
        content.innerHTML = `<p class="muted">Não foi possível carregar as mensagens. Verifique a conexão e tente novamente.</p>`;
      });
      return;
    }
    content.innerHTML = `<p class="support-subject"><strong>${escapeHtml(request.subject)}</strong> · ${escapeHtml(request.status)}</p>${supportMessageList(request, "public")}${supportComposer(request, "public", requesterId, request.requester_name, "public", request.requester_contact || "")}`;
    bindSupportComposer(content, renderPublicSupportChat);
    return;
  }

  const latest = latestSupportRequest(requesterId);
  const previousName = latest?.requester_name || localStorage.getItem("ceti-public-support-name") || "";
  const previousContact = latest?.requester_contact || localStorage.getItem("ceti-public-support-contact") || "";
  content.innerHTML = `${latest ? `<p class="support-closed-note">Este assunto foi encerrado. Se precisar, inicie uma nova conversa.</p>` : `<p class="muted">Informe seus dados para que a Secretaria possa responder.</p>`}<form class="support-composer" data-public-support-start>
    <label>Nome<input class="input" name="name" value="${escapeHtml(previousName)}" required></label>
    <label>Contato<input class="input" name="contact" value="${escapeHtml(previousContact)}" placeholder="E-mail ou telefone" required></label>
    <label>Assunto<select class="input" name="subject"><option>Dúvida</option><option>Declaração</option><option>Diploma ou histórico</option><option>Matrícula ou rematrícula</option><option>Pedido de impressão</option><option>Outro atendimento</option></select></label>
    <label>Mensagem<textarea class="input" name="message" rows="3"></textarea></label>
    <label class="support-file-label">Anexar documento<input class="input" name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"></label>
    <button class="button primary" type="submit">Enviar para a Secretaria</button>
  </form>`;
  $("[data-public-support-start]", content).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("button[type=submit]", form);
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const name = String(values.get("name") || "").trim();
      const contact = String(values.get("contact") || "").trim();
      const body = String(values.get("message") || "").trim();
      const file = values.get("file");
      const attachment = file?.size ? (await readAttachments([file]))[0] : null;
      const request = await startSupportConversation({
        requesterId,
        requesterName: name,
        requesterRole: "public",
        contact,
        subject: String(values.get("subject") || "Atendimento"),
        body,
        attachment
      });
      if (request) {
        localStorage.setItem("ceti-public-support-name", name);
        localStorage.setItem("ceti-public-support-contact", contact);
        renderPublicSupportChat();
      }
    } catch (error) {
      console.error("Erro ao iniciar atendimento público:", error);
      toast(error.message || "Não foi possível iniciar o atendimento.");
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  });
}

function setupUi() {
  document.addEventListener("input", (event) => {
    if (event.target.matches("input, textarea, select") && event.target.closest("form")) hasUnsavedFormChanges = true;
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target.matches("input, textarea, select") && event.target.closest("form")) hasUnsavedFormChanges = true;
  }, true);
  document.body.insertAdjacentHTML("beforeend", `<button class="public-secretary-chat" type="button" data-public-chat-toggle aria-label="Falar com a Secretaria" title="Falar com a Secretaria">${secretaryChatIcon()}</button><section class="public-secretary-chat-box" data-public-chat-box hidden><div class="portal-heading compact"><div><h3>Atendimento da Secretaria</h3><p class="muted">Declarações, diplomas, dúvidas e outros serviços.</p></div><button class="button ghost" type="button" data-public-chat-close aria-label="Fechar janela do chat">×</button></div><div data-public-chat-content></div></section>`);
  $("[data-public-chat-toggle]")?.addEventListener("click", () => {
    const box = $("[data-public-chat-box]");
    if (box) {
      box.hidden = !box.hidden;
      if (!box.hidden) renderPublicSupportChat();
    }
  });
  $("[data-public-chat-close]")?.addEventListener("click", () => { $("[data-public-chat-box]").hidden = true; });
  $("[data-menu-toggle]")?.addEventListener("click", () => {
    $("[data-nav-panel]")?.classList.toggle("open");
    document.body.classList.toggle("no-scroll");
  });

  $$('[data-calendar-view]').forEach((button) =>
    button.addEventListener("click", () => {
      currentCalendarView = button.dataset.calendarView;
      renderCalendar();
    })
  );

  $("[data-scroll-to-top]")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  setInterval(() => {
    const media = $("[data-hero-media]");
    if (media) media.style.backgroundPosition = `${50 + Math.sin(Date.now() / 2500) * 3}% center`;
  }, 500);
}

// ==================== INICIALIZAÇÃO ====================
async function refreshDataInBackground() {
  if (document.hidden) return;
  // Não recarrega/recria o painel enquanto a pessoa estiver preenchendo algo.
  // Antes disso, o refresh de 30 segundos apagava o texto não salvo.
  if (hasUnsavedFormChanges) return;
  const updated = await loadDataFromSupabase({ useCache: true, forceNetwork: true, skipIfUnsaved: true });
  if (!updated || hasUnsavedFormChanges) return;
  if (currentPageName() === "login") renderLoginPortal();
  else renderVisiblePublicPage();
}

window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", async () => {
  document.title = `${SCHOOL_TITLE} | Portal`;
  clearCache("support_messages");
  let cacheUsed = false;
  let staleCacheUsed = false;
  const initialDataLoaded = await loadDataFromSupabase({
    useCache: true,
    allowStaleCache: true,
    onStaleCache: () => { staleCacheUsed = true; },
    onCacheUsed: () => { cacheUsed = true; }
  });
  renderPublic();
  setupUi();
  setupPreferences();
  route();
  if (!initialDataLoaded || staleCacheUsed || cacheUsed) void refreshDataInBackground();
  window.setInterval(refreshDataInBackground, 120000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshDataInBackground();
  });
});
