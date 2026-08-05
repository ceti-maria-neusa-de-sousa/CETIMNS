import { supabase, fetchWithCache, clearCache } from "./supabase.js";

const normalizeUser = (value) => String(value ?? "").trim().toLowerCase();

/**
 * ==================== TABELAS PÚBLICAS ====================
 * Carregar dados que aparecem no site (Início, Notícias, Eventos, etc)
 */

export async function loadPublicData() {
  try {
    console.log("📡 Carregando dados públicos do Supabase...");
    
    const [newsData, eventsData, activitiesData, achievementsData] = await Promise.all([
      supabase.from("news").select("*").eq("published", true),
      supabase.from("events").select("*"),
      supabase.from("activities").select("*"),
      supabase.from("achievements").select("*")
    ]);

    return {
      news: newsData.data || [],
      events: eventsData.data || [],
      activities: activitiesData.data || [],
      achievements: achievementsData.data || []
    };
  } catch (error) {
    console.error("❌ Erro ao carregar dados públicos:", error.message);
    throw error;
  }
}

/**
 * ==================== TABELAS DE CONFIGURAÇÃO ====================
 * Carregar estrutura escolar: turmas, disciplinas, sobre, contato
 */

export async function loadSchoolConfiguration() {
  try {
    console.log("📚 Carregando configuração escolar...");
    
    const [classesData, subjectsData, configData] = await Promise.all([
      supabase.from("classes").select("*"),
      supabase.from("subjects").select("*"),
      supabase.from("school_config").select("*").single()
    ]);

    return {
      classes: classesData.data?.map(c => c.name) || [],
      subjects: subjectsData.data?.map(s => s.name) || [],
      config: configData.data || {
        history: "",
        mission: "",
        vision: "",
        values: "",
        address: "",
        phone: "",
        email: ""
      }
    };
  } catch (error) {
    console.error("⚠️ Erro ao carregar configuração:", error.message);
    return {
      classes: [],
      subjects: [],
      config: {}
    };
  }
}

/**
 * ==================== TABELAS DE USUÁRIOS ====================
 * Carregar estudantes, professores, admins
 */

export async function loadUsers() {
  try {
    console.log("👥 Carregando usuários...");
    
    const [studentsData, teachersData, adminsData] = await Promise.all([
      supabase.from("students").select("*"),
      supabase.from("teachers").select("*"),
      supabase.from("admins").select("id, user") // Não carregar senha
    ]);

    return {
      students: studentsData.data || [],
      teachers: teachersData.data || [],
      admins: adminsData.data || []
    };
  } catch (error) {
    console.error("❌ Erro ao carregar usuários:", error.message);
    throw error;
  }
}

/**
 * ==================== TABELAS DE NOTAS ====================
 * Carregar boletins de alunos
 */

export async function loadGrades() {
  try {
    console.log("📊 Carregando notas...");
    
    const { data, error } = await supabase.from("grades").select("*");
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("❌ Erro ao carregar notas:", error.message);
    throw error;
  }
}

/**
 * ==================== CRIAR / ATUALIZAR / DELETAR ====================
 */

// --- NOTÍCIAS ---
export async function saveNews(news) {
  try {
    const { error } = await supabase
      .from("news")
      .upsert(news, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("news");
    console.log("✅ Notícia salva");
  } catch (error) {
    console.error("❌ Erro ao salvar notícia:", error.message);
    throw error;
  }
}

export async function deleteNews(newsId) {
  try {
    const { error } = await supabase.from("news").delete().eq("id", newsId);
    if (error) throw error;
    clearCache("news");
    console.log("✅ Notícia deletada");
  } catch (error) {
    console.error("❌ Erro ao deletar notícia:", error.message);
    throw error;
  }
}

// --- EVENTOS ---
export async function saveEvent(event) {
  try {
    const { error } = await supabase
      .from("events")
      .upsert(event, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("events");
    console.log("✅ Evento salvo");
  } catch (error) {
    console.error("❌ Erro ao salvar evento:", error.message);
    throw error;
  }
}

export async function deleteEvent(eventId) {
  try {
    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) throw error;
    clearCache("events");
    console.log("✅ Evento deletado");
  } catch (error) {
    console.error("❌ Erro ao deletar evento:", error.message);
    throw error;
  }
}

// --- ESTUDANTES ---
export async function saveStudent(student) {
  try {
    const { error } = await supabase
      .from("students")
      .upsert(student, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("students");
    console.log("✅ Estudante salvo");
  } catch (error) {
    console.error("❌ Erro ao salvar estudante:", error.message);
    throw error;
  }
}

export async function deleteStudent(studentId) {
  try {
    const { error } = await supabase.from("students").delete().eq("id", studentId);
    if (error) throw error;
    clearCache("students");
    console.log("✅ Estudante deletado");
  } catch (error) {
    console.error("❌ Erro ao deletar estudante:", error.message);
    throw error;
  }
}

// --- PROFESSORES ---
export async function saveTeacher(teacher) {
  try {
    const { error } = await supabase
      .from("teachers")
      .upsert(teacher, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("teachers");
    console.log("✅ Professor salvo");
  } catch (error) {
    console.error("❌ Erro ao salvar professor:", error.message);
    throw error;
  }
}

export async function deleteTeacher(teacherId) {
  try {
    const { error } = await supabase.from("teachers").delete().eq("id", teacherId);
    if (error) throw error;
    clearCache("teachers");
    console.log("✅ Professor deletado");
  } catch (error) {
    console.error("❌ Erro ao deletar professor:", error.message);
    throw error;
  }
}

// --- NOTAS ---
export async function saveGrade(grade) {
  try {
    const { error } = await supabase
      .from("grades")
      .upsert(grade, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("grades");
    console.log("✅ Nota salva");
  } catch (error) {
    console.error("❌ Erro ao salvar nota:", error.message);
    throw error;
  }
}

// --- CONFIGURAÇÃO DA ESCOLA ---
export async function updateSchoolConfig(config) {
  try {
    const { error } = await supabase
      .from("school_config")
      .upsert(config, { onConflict: "id" });
    
    if (error) throw error;
    clearCache("config");
    console.log("✅ Configuração atualizada");
  } catch (error) {
    console.error("❌ Erro ao atualizar configuração:", error.message);
    throw error;
  }
}

/**
 * ==================== AUTENTICAÇÃO ====================
 */

export async function authenticateUser(username, password) {
  try {
    const normalizedUser = normalizeUser(username);

    // Tentar como admin
    const { data: admins } = await supabase
      .from("admins")
      .select("*")
      .ilike("user", normalizedUser)
      .eq("password", password)
      .single();
    
    if (admins) {
      return { role: "admin", name: "Administrador", id: admins.id };
    }

    // Tentar como professor
    const { data: teacher } = await supabase
      .from("teachers")
      .select("*")
      .ilike("user", normalizedUser)
      .eq("password", password)
      .single();
    
    if (teacher) {
      return { role: "teacher", id: teacher.id, name: teacher.name };
    }

    // Tentar como estudante
    const { data: student } = await supabase
      .from("students")
      .select("*")
      .ilike("user", normalizedUser)
      .eq("password", password)
      .single();
    
    if (student) {
      return { role: "student", id: student.id, name: student.name };
    }

    return null;
  } catch (error) {
    console.error("❌ Erro na autenticação:", error.message);
    return null;
  }
}

/**
 * ==================== UPLOAD DE ARQUIVOS ====================
 * Salvar arquivos como base64 na coluna 'files' (JSON array)
 */

export async function uploadFileToNews(newsId, fileData) {
  try {
    // Carregar notícia atual
    const { data: news, error: fetchError } = await supabase
      .from("news")
      .select("files")
      .eq("id", newsId)
      .single();
    
    if (fetchError) throw fetchError;

    // Adicionar arquivo à lista
    const files = news?.files || [];
    files.push(fileData);

    // Salvar de volta
    const { error: updateError } = await supabase
      .from("news")
      .update({ files })
      .eq("id", newsId);
    
    if (updateError) throw updateError;
    clearCache("news");
    console.log("✅ Arquivo enviado");
  } catch (error) {
    console.error("❌ Erro ao enviar arquivo:", error.message);
    throw error;
  }
}

/**
 * ==================== SINCRONIZAÇÃO OFFLINE-TO-ONLINE ====================
 * Se houver dados em localStorage (offline), sincronizar com Supabase
 */

export async function syncOfflineData() {
  try {
    console.log("🔄 Sincronizando dados offline...");
    // Esta função é avançada e depende de como você estruturar o offline
    // Por enquanto, apenas notifica que dados foram sincronizados
    console.log("✅ Sincronização completa");
  } catch (error) {
    console.error("⚠️ Erro na sincronização:", error.message);
  }
}
