import { supabase } from "./supabase.js";

/**
 * Script to seed the initial admin account and school defaults.
 * Run it from the browser console or from a small HTML runner.
 */

async function setupAdmin() {
  try {
    console.log("Criando conta admin...");

    const { data, error } = await supabase
      .from("admins")
      .upsert(
        [
          {
            user: "admin",
            password: "cetimns26"
          }
        ],
        { onConflict: "user" }
      )
      .select();

    if (error) throw error;
    console.log("Admin criado ou atualizado com sucesso!", data);

    console.log("Criando configuracao da escola...");
    const { error: configError } = await supabase.from("school_config").upsert(
      [
        {
          id: "00000000-0000-0000-0000-000000000001",
          history: "CETI Maria Neusa de Sousa - Centro Estadual de Tempo Integral",
          mission: "Formar cidados criticos e competentes",
          vision: "Excelencia em educacao integral",
          values: "Respeito, Responsabilidade, Inovacao",
          address: "Francisco Macedo, PI",
          phone: "(86) XXXX-XXXX",
          email: "ceti@seduc.pi.gov.br",
          team: []
        }
      ],
      { onConflict: "id" }
    );

    if (configError) {
      console.warn("Erro ao criar config:", configError);
    } else {
      console.log("Configuracao da escola criada!");
    }

    console.log("Criando turmas iniciais...");
    const classes = ["1 Ano A", "1 Ano B", "2 Ano A", "2 Ano B", "3 Ano A", "3 Ano B"];

    for (const classname of classes) {
      const { error: classError } = await supabase
        .from("classes")
        .upsert([{ name: classname }], { onConflict: "name" });

      if (classError) {
        console.warn(`Erro ao criar turma ${classname}:`, classError);
      }
    }
    console.log("Turmas criadas!");

    console.log("Criando disciplinas iniciais...");
    const subjects = [
      "Portugues",
      "Matematica",
      "Ciencias",
      "Historia",
      "Geografia",
      "Educacao Fisica",
      "Arte",
      "Ingles"
    ];

    for (const subject of subjects) {
      const { error: subjectError } = await supabase
        .from("subjects")
        .upsert([{ name: subject }], { onConflict: "name" });

      if (subjectError) {
        console.warn(`Erro ao criar disciplina ${subject}:`, subjectError);
      }
    }
    console.log("Disciplinas criadas!");

    console.log("SETUP COMPLETO!");
    console.log("Usuario: admin");
    console.log("Senha: cetimns26");
    console.log("Agora o acesso administrativo esta pronto.");
  } catch (error) {
    console.error("Erro durante o setup:", error);
  }
}

setupAdmin();
