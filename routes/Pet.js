import express from "express";
import Pets from "../models/Pets.js";
import auth from "../middlewares/auth.js";
import Custumers from "../models/Custumers.js";
import { Op } from "sequelize";
import Belongings from "../models/Belongings.js";
import sequelize from "../database/config.js";

const router = express.Router();

// Coloque a rota de batch delete AQUI, antes de todas as outras rotas
router.delete("/pets/batch", auth, async (req, res) => {
  try {
    console.log("Received data:", req.body);
    const { petIds } = req.body;

    if (!petIds || !Array.isArray(petIds) || petIds.length === 0) {
      return res.status(400).json({
        message: "Lista de pets inválida",
      });
    }

    // Extrai apenas os IDs do array de objetos
    const ids = petIds.map((pet) => pet.id);

    console.log("IDs extraídos:", ids);

    // Verifica se todos os pets pertencem ao estabelecimento
    const existingPets = await Pets.findAll({
      where: {
        id: ids,
        usersId: req.user.establishment,
      },
    });

    if (existingPets.length === 0) {
      return res.status(404).json({
        message: "Nenhum pet encontrado para exclusão",
      });
    }

    // Remove todos os registros relacionados ao pet
    await Promise.all(
      ids.map(async (petId) => {
        // Remove appointments primeiro devido à restrição de chave estrangeira
        await sequelize.query("DELETE FROM appointments WHERE petId = ?", {
          replacements: [petId],
          type: sequelize.QueryTypes.DELETE,
        });

        // Remove pertences
        await Belongings.destroy({
          where: { petId },
        });

        // Remove outros registros relacionados se necessário
      })
    );

    // Remove os pets
    const deletedCount = await Pets.destroy({
      where: {
        id: ids,
        usersId: req.user.establishment,
      },
    });

    return res.status(200).json({
      success: true,
      message: `${deletedCount} pet(s) e todos seus registros relacionados foram removidos com sucesso`,
    });
  } catch (error) {
    console.error("Erro ao remover pets:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao remover pets",
      error: error.message,
    });
  }
});

// Rota para adicionar um novo pet
router.post("/pets", auth, async (req, res) => {
  try {
    const {
      name,
      species,
      breed,
      color,
      sex,
      birthdate,
      age,
      observation,
      allergic,
      customerId,
      feedBrand,
      hygienicCarpet,
      favoriteTreat,
    } = req.body;
    // Garante compatibilidade: aceita tanto customerId quanto custumerId
    const custumerId = customerId || req.body.custumerId;
    // Valida se o cliente existe e pertence ao estabelecimento
    const customer = await Custumers.findOne({
      where: { id: custumerId, usersId: req.user.establishment },
    });
    if (!customer) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }
    // Calcula birthdate a partir da idade se necessário
    let calculatedBirthdate = birthdate;
    if (!birthdate && age) {
      const today = new Date();
      calculatedBirthdate = new Date(
        today.getFullYear() - age,
        today.getMonth(),
        today.getDate()
      )
        .toISOString()
        .split("T")[0];
    }
    // Formata a data de aniversário para incluir o horário
    let formattedBirthdate = null;
    if (calculatedBirthdate) {
      formattedBirthdate = new Date(calculatedBirthdate + "T12:00:00");
    }
    // Cria o novo pet
    const pet = await Pets.create({
      usersId: req.user.establishment,
      name,
      species,
      breed,
      color,
      sex,
      birthdate: formattedBirthdate,
      age: age || null,
      custumerId,
      feedBrand,
      hygienicCarpet,
      favoriteTreat,
      observation,
      allergic,
    });
    return res.status(201).json({
      message: "Pet cadastrado com sucesso",
      data: pet,
    });
  } catch (error) {
    console.error("Erro ao cadastrar pet:", error);
    return res.status(500).json({
      message: "Erro ao cadastrar pet",
      error: error.message,
    });
  }
});

router.get("/pets/search", auth, async (req, res) => {
  // NOVA ROTA para busca de Pets
  try {
    const { search } = req.query; // Recebe o termo de busca da query string

    let whereClause = { usersId: req.user.establishment }; // Cláusula WHERE base

    if (search) {
      // Se um termo de busca for fornecido
      whereClause = {
        ...whereClause,
        name: { [Op.like]: `%${search}%` }, // Adiciona filtro por nome (case-insensitive usando Op.like direto)
      };
    }

    const pets = await Pets.findAll({
      where: whereClause,
      order: [["name", "ASC"]],
    });

    // Busca os IDs dos clientes dos pets
    const customerIds = [...new Set(pets.map((pet) => pet.custumerId))];

    // Busca os clientes correspondentes
    const customers = await Custumers.findAll({
      where: {
        id: { [Op.in]: customerIds },
        usersId: req.user.establishment,
      },
      attributes: ["id", "name"],
    });

    // Cria um mapa de id -> nome do cliente para fácil acesso
    const customerMap = customers.reduce((acc, customer) => {
      acc[customer.id] = customer.name;
      return acc;
    }, {});

    // Busca os pertences de todos os pets
    const belongings = await Belongings.findAll({
      where: {
        petId: pets.map((pet) => pet.id),
      },
    });

    // Cria um mapa de petId -> belongings
    const belongingsMap = belongings.reduce((acc, belonging) => {
      if (!acc[belonging.petId]) {
        acc[belonging.petId] = [];
      }
      acc[belonging.petId].push(belonging);
      return acc;
    }, {});

    // Adiciona o nome do cliente e os pertences a cada pet
    const petsWithCustomerName = pets.map((pet) => ({
      ...pet.toJSON(),
      customerName: customerMap[pet.custumerId] || "Sem tutor",
      belongings: belongingsMap[pet.id] || [],
    }));

    return res.status(200).json({
      message: "Pets encontrados com sucesso",
      data: petsWithCustomerName,
    });
  } catch (error) {
    console.error("Erro ao buscar pets:", error);
    return res.status(500).json({
      message: "Erro ao buscar pets",
      error: error.message,
    });
  }
});

// Rota para listar todos os pets
// Rota para listar todos os pets
router.get("/pets", auth, async (req, res) => {
  try {
    const includeBelongings = !["0", "false", "no"].includes(
      String(req.query.includeBelongings || "true").trim().toLowerCase(),
    );
    const pets = await Pets.findAll({
      where: { usersId: req.user.establishment },
      order: [["name", "ASC"]],
    });

    // Busca os IDs dos clientes dos pets
    const customerIds = [...new Set(pets.map((pet) => pet.custumerId))];

    // Busca os clientes correspondentes, incluindo o telefone
    const customers = await Custumers.findAll({
      where: {
        id: { [Op.in]: customerIds },
        usersId: req.user.establishment,
      },
      attributes: ["id", "name", "phone"], // Garante que 'phone' seja selecionado
    });

    // Cria um mapa de id -> { name, phone } do cliente para fácil acesso
    const customerMap = customers.reduce((acc, customer) => {
      acc[customer.id] = {
        name: customer.name,
        phone: customer.phone,
      };
      return acc;
    }, {});

    // Busca os pertences de todos os pets
    const belongings =
      includeBelongings && pets.length
        ? await Belongings.findAll({
            where: {
              petId: pets.map((pet) => pet.id),
            },
          })
        : [];

    // Cria um mapa de petId -> belongings
    const belongingsMap = includeBelongings
      ? belongings.reduce((acc, belonging) => {
          if (!acc[belonging.petId]) {
            acc[belonging.petId] = [];
          }
          acc[belonging.petId].push(belonging);
          return acc;
        }, {})
      : {};

    // Adiciona o nome e telefone do cliente e os pertences a cada pet
    const petsWithCustomerInfo = pets.map((pet) => {
      const customerData = customerMap[pet.custumerId] || {
        name: "Sem tutor",
        phone: "Não informado",
      }; // Pega name e phone ou valores padrão
      return {
        ...pet.toJSON(),
        customerId: pet.custumerId, // Incluir customerId
        customerName: customerData.name, // Usa o nome do cliente do mapa
        customerPhone: customerData.phone, // Usa o telefone do cliente do mapa
        belongings: includeBelongings ? belongingsMap[pet.id] || [] : [],
      };
    });

    return res.status(200).json({
      message: "Pets encontrados com sucesso",
      data: petsWithCustomerInfo,
    });
  } catch (error) {
    console.error("Erro ao buscar pets:", error);
    return res.status(500).json({
      message: "Erro ao buscar pets",
      error: error.message,
    });
  }
});
// Rota para lista 1 pet
router.get("/pet/:id", auth, async (req, res) => {
  const id = req.params.id;

  try {
    const pet = await Pets.findOne({
      where: { usersId: req.user.establishment, id: id },
      order: [["name", "ASC"]],
    });

    // Busca os pertences do pet
    const belongings = await Belongings.findAll({
      where: { petId: id },
    });

    // Adiciona os pertences ao objeto do pet
    const petData = {
      ...pet.toJSON(),
      belongings: belongings,
    };

    return res.status(200).json({
      message: "Pet encontrado com sucesso",
      data: petData,
    });
  } catch (error) {
    console.error("Erro ao buscar pet:", error);
    return res.status(500).json({
      message: "Erro ao buscar pet",
      error: error.message,
    });
  }
});

// Rota para buscar pets de um cliente específico
router.get("/pets/customer/:customerId", auth, async (req, res) => {
  try {
    const { customerId } = req.params;

    const pets = await Pets.findAll({
      where: {
        usersId: req.user.establishment,
        custumerId: customerId,
      },
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      message: "Pets encontrados com sucesso",
      data: pets,
    });
  } catch (error) {
    console.error("Erro ao buscar pets do cliente:", error);
    return res.status(500).json({
      message: "Erro ao buscar pets do cliente",
      error: error.message,
    });
  }
});

// Rota para atualizar um pet
router.put("/pets/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const {
      name,
      species,
      breed,
      color,
      sex,
      birthdate,
      observation,
      allergic,
      customerId,
      feedBrand,
      hygienicCarpet,
      favoriteTreat,
    } = req.body;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({
        message: "Pet não encontrado",
      });
    }

    // Formata a data de nascimento para o formato correto
    let formattedBirthdate = pet.birthdate;
    if (birthdate) {
      formattedBirthdate = new Date(birthdate + "T12:00:00");
    }

    // Atualiza os dados do pet
    await pet.update({
      name: name || pet.name,
      species: species || pet.species,
      breed: breed || pet.breed,
      color: color || pet.color,
      sex: sex || pet.sex,
      birthdate: formattedBirthdate,
      observation: observation || pet.observation,
      allergic: allergic || pet.allergic,
      feedBrand,
      hygienicCarpet,
      favoriteTreat,
      custumerId: customerId,
    });

    return res.status(200).json({
      message: "Pet atualizado com sucesso",
      data: pet,
    });
  } catch (error) {
    console.error("Erro ao atualizar pet:", error);
    return res.status(500).json({
      message: "Erro ao atualizar pet",
      error: error.message,
    });
  }
});

// Rota para remover um pet
router.delete("/pets/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({
        message: "Pet não encontrado",
      });
    }

    // Remove o pet
    await pet.destroy();

    return res.status(200).json({
      message: "Pet removido com sucesso",
    });
  } catch (error) {
    console.error("Erro ao remover pet:", error);
    return res.status(500).json({
      message: "Erro ao remover pet",
      error: error.message,
    });
  }
});

// Adicione esta rota de importação
router.post("/pets/import", auth, async (req, res) => {
  try {
    const { pets } = req.body;

    if (!pets || !Array.isArray(pets)) {
      return res.status(400).json({
        success: false,
        message: "Dados inválidos para importação",
      });
    }

    // Função para separar espécie/raça/cor
    const parseSpeciesBreedColor = (text) => {
      if (!text) return { species: "", breed: "", color: "" };

      // Assume que o primeiro termo é a espécie
      const parts = text.trim().split(/\s+/);
      const species = parts[0] || "";

      // Remove a espécie e junta o resto
      parts.shift();
      const remaining = parts.join(" ");

      // Assume que a última palavra é a cor (se houver mais de uma palavra)
      let breed = remaining;
      let color = "";

      if (parts.length > 1) {
        color = parts.pop();
        breed = parts.join(" ");
      }

      return { species, breed, color };
    };

    // Função para calcular a data de nascimento a partir da idade
    const calculateBirthdate = (ageText) => {
      if (!ageText) return null;

      try {
        const matches = ageText.match(/(\d+)\s*anos?\s*(?:(\d+)\s*meses?)?/);
        if (!matches) return null;

        const years = parseInt(matches[1]) || 0;
        const months = parseInt(matches[2]) || 0;

        const today = new Date();
        const birthdate = new Date(today);
        birthdate.setFullYear(birthdate.getFullYear() - years);
        birthdate.setMonth(birthdate.getMonth() - months);

        return birthdate.toISOString().split("T")[0];
      } catch (error) {
        console.error("Erro ao calcular data de nascimento:", error);
        return null;
      }
    };

    // Processa os pets
    const processedPets = await Promise.all(
      pets.map(async (pet) => {
        try {
          // Busca o cliente pelo email e nome
          const customer = await Custumers.findOne({
            where: {
              [Op.and]: [
                { usersId: req.user.establishment },
                {
                  [Op.or]: [{ email: pet.email }, { name: pet.tutorName }],
                },
              ],
            },
          });

          if (!customer) {
            console.error(
              `Cliente não encontrado para o email: ${pet.email} ou nome: ${pet.tutorName}`
            );
            return null;
          }

          // Processa espécie/raça/cor
          const { species, breed, color } = parseSpeciesBreedColor(
            pet.speciesBreedColor
          );

          // Calcula a data de nascimento
          const birthdate = calculateBirthdate(pet.birthdateAge);

          return {
            usersId: req.user.establishment,
            name: pet.name,
            species,
            breed,
            color,
            birthdate,
            custumerId: customer.id,
            observation: "",
            allergic: "",
          };
        } catch (error) {
          console.error("Erro ao processar pet:", error);
          return null;
        }
      })
    );

    // Filtra pets válidos
    const validPets = processedPets.filter((pet) => pet !== null);

    if (validPets.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum pet válido para importação",
      });
    }

    // Importa os pets
    const results = await Promise.allSettled(
      validPets.map((pet) =>
        Pets.create(pet).catch((error) => {
          console.error("Erro ao criar pet:", error);
          return null;
        })
      )
    );

    // Conta sucessos e falhas
    const imported = results.filter(
      (r) => r.status === "fulfilled" && r.value
    ).length;
    const failed = validPets.length - imported;

    return res.status(200).json({
      success: true,
      message: `${imported} pets importados com sucesso${
        failed > 0 ? `. ${failed} falharam.` : ""
      }`,
      importedCount: imported,
      failedCount: failed,
    });
  } catch (error) {
    console.error("Erro ao importar pets:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao importar pets",
      error: error.message,
    });
  }
});

// Rota para adicionar um item a um pet
router.post("/pets/:petId/belongings", auth, async (req, res) => {
  try {
    const petId = req.params.petId;
    const { name, description } = req.body;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Valida os dados obrigatórios
    if (!name) {
      return res
        .status(400)
        .json({ message: "Nome do pertence é obrigatório" });
    }

    // Cria o pertence
    const belonging = await Belongings.create({
      petId,
      name,
      description,
    });

    return res.status(201).json({
      message: "Pertence adicionado com sucesso",
      data: belonging,
    });
  } catch (error) {
    console.error("Erro ao adicionar pertence:", error);
    return res.status(500).json({
      message: "Erro ao adicionar pertence",
      error: error.message,
    });
  }
});
// Rota para remover um pertence de um pet
router.delete(
  "/pets/:petId/belongings/:belongingId",
  auth,
  async (req, res) => {
    try {
      const { petId, belongingId } = req.params;

      // Verifica se o pet existe e pertence ao estabelecimento
      const pet = await Pets.findOne({
        where: {
          id: petId,
          usersId: req.user.establishment,
        },
      });

      if (!pet) {
        return res.status(404).json({ message: "Pet não encontrado" });
      }

      // Verifica se o pertence existe e pertence ao pet
      const belonging = await Belongings.findOne({
        where: {
          id: belongingId,
          petId,
        },
      });

      if (!belonging) {
        return res.status(404).json({ message: "Pertence não encontrado" });
      }

      // Remove o pertence
      await belonging.destroy();

      return res.status(200).json({
        message: "Pertence removido com sucesso",
      });
    } catch (error) {
      console.error("Erro ao remover pertence:", error);
      return res.status(500).json({
        message: "Erro ao remover pertence",
        error: error.message,
      });
    }
  }
);

// Rota para obter os pertences de um pet
router.get("/pets/:petId/belongings", auth, async (req, res) => {
  try {
    const { petId } = req.params;

    // Verifica se o pet existe e pertence ao estabelecimento
    const pet = await Pets.findOne({
      where: {
        id: petId,
        usersId: req.user.establishment,
      },
    });

    if (!pet) {
      return res.status(404).json({ message: "Pet não encontrado" });
    }

    // Busca todos os pertences do pet
    const belongings = await Belongings.findAll({
      where: { petId },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json(belongings);
  } catch (error) {
    console.error("Erro ao buscar pertences:", error);
    return res.status(500).json({
      message: "Erro ao buscar pertences",
      error: error.message,
    });
  }
});

export default router;
