import express from "express";
import Custumers from "../models/Custumers.js";
import auth from "../middlewares/auth.js";
import { Op } from "sequelize";
import Pets from "../models/Pets.js";
import Sequelize from "sequelize";
import Appointment from "../models/Appointment.js";
import Services from "../models/Services.js";
import Sales from "../models/Sales.js";
import SaleItem from "../models/SaleItem.js";
import Product from "../models/Products.js";
const router = express.Router();

router.get("/customers/search", auth, async (req, res) => {
  try {
    const { term } = req.query;
    const { establishment } = req.user;

    if (!term) {
      return res.status(400).json({
        message: "Termo de busca é obrigatório",
      });
    }

    const customers = await Custumers.findAll({
      where: {
        usersId: establishment,
        [Op.or]: [
          { name: { [Op.like]: `${term}%` } }, // Nome começa com o termo
          { email: { [Op.like]: `${term}%` } }, // Email começa com o termo
          { phone: { [Op.like]: `${term}%` } }, // Telefone começa com o termo
        ],
      },
      attributes: ["id", "name", "email", "phone"],
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      message: "Clientes encontrados com sucesso",
      customers: customers,
    });
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    return res.status(500).json({
      message: "Erro ao buscar clientes",
      error: error.message,
    });
  }
});

// Mova a rota de batch delete para antes da rota com parâmetro
// Coloque esta rota ANTES de qualquer rota que use /customers/:id
router.delete("/customers/batch", auth, async (req, res) => {
  try {
    console.log("Received data:", req.body);
    const { customerIds } = req.body;

    if (
      !customerIds ||
      !Array.isArray(customerIds) ||
      customerIds.length === 0
    ) {
      return res.status(400).json({
        message: "Lista de IDs de clientes inválida",
      });
    }

    // Extrai apenas os IDs dos objetos de cliente
    const ids = customerIds.map((customer) => customer.id);

    // Verifica se todos os clientes pertencem ao estabelecimento
    const customers = await Custumers.findAll({
      where: {
        id: ids,
        usersId: req.user.establishment,
      },
    });

    if (customers.length === 0) {
      return res.status(404).json({
        message: "Nenhum cliente encontrado para exclusão",
      });
    }

    // Remove na ordem correta para respeitar as constraints de chave estrangeira

    // 1. Remove os itens de venda primeiro
    await SaleItem.destroy({
      where: {
        saleId: {
          [Op.in]: Sequelize.literal(
            `(SELECT id FROM sales WHERE custumerId IN (${ids
              .map((id) => `'${id}'`)
              .join(",")}))`
          ),
        },
      },
    });

    // 2. Remove as vendas
    await Sales.destroy({
      where: {
        custumerId: ids,
      },
    });

    // 3. Remove os agendamentos
    await Appointment.destroy({
      where: {
        customerId: ids,
        usersId: req.user.establishment,
      },
    });

    // 4. Remove os pets
    await Pets.destroy({
      where: {
        custumerId: ids,
        usersId: req.user.establishment,
      },
    });

    // 5. Finalmente, remove os clientes
    const deletedCount = await Custumers.destroy({
      where: {
        id: ids,
        usersId: req.user.establishment,
      },
    });

    return res.status(200).json({
      success: true,
      message: `${deletedCount} cliente(s) e seus dados relacionados removidos com sucesso`,
    });
  } catch (error) {
    console.error("Erro ao remover clientes:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao remover clientes e seus dados relacionados",
      error: error.message,
    });
  }
});
// Rota para adicionar um novo cliente
router.post("/customers", auth, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      city,
      bairro,
      state,
      complement,
      observation,
      birthDate,
      cpf,
      grupo,
      profissao,
      rg,
      status = true, // Valor padrão true
    } = req.body;

    // Cria o novo cliente
    const customer = await Custumers.create({
      usersId: req.user.establishment, // ID do usuário logado
      name,
      email,
      phone,
      address,
      city,
      bairro: bairro || null,
      state,
      complement,
      grupo: grupo || null,
      profissao: profissao || null,
      rg: rg || null,
      observation,
      birthDate: birthDate || null,
      cpf: cpf || null,
      status,
    });

    return res.status(201).json({
      message: "Cliente cadastrado com sucesso",
      customer,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao cadastrar cliente" });
  }
});

router.get("/customers/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Custumers.findOne({
      where: {
        id: id,
        usersId: req.user.establishment, // Garante que o cliente pertence ao estabelecimento do usuário logado
      },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message:
          "Cliente não encontrado ou não pertence a este estabelecimento.",
      });
    }

    // Opcional: Buscar pets associados se necessário nesta visualização específica
    const pets = await Pets.findAll({
      where: { custumerId: customer.id },
    });

    return res.status(200).json({
      success: true,
      message: "Cliente encontrado com sucesso.",
      data: {
        ...customer.toJSON(),
        pets, // Inclui os pets na resposta
      },
    });
  } catch (error) {
    console.error("Erro ao buscar cliente por ID:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao buscar cliente",
      error: error.message,
    });
  }
});

// Rota para listar todos os clientes
router.get("/customers", auth, async (req, res) => {
  try {
    const customers = await Custumers.findAll({
      where: { usersId: req.user.establishment },
      order: [["name", "ASC"]],
    });

    const customerIds = customers.map((customer) => customer.id);
    const pets = customerIds.length
      ? await Pets.findAll({
          where: {
            usersId: req.user.establishment,
            custumerId: { [Op.in]: customerIds },
          },
          order: [["name", "ASC"]],
        })
      : [];

    const petsByCustomerId = pets.reduce((accumulator, pet) => {
      const key = String(pet.custumerId || "");
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push(pet);
      return accumulator;
    }, {});

    const customersWithPets = customers.map((customer) => ({
      ...customer.toJSON(),
      pets: petsByCustomerId[String(customer.id)] || [],
    }));

    return res.status(200).json({
      message: "Clientes encontrados com sucesso",
      data: customersWithPets,
    });
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    return res.status(500).json({
      message: "Erro ao buscar clientes",
      error: error.message,
    });
  }
});

//Rota para listar dados usuario
router.get("/custumer/:id", auth, async (req, res) => {
  const id = req.params.id;
  try {
    const custumer = await Custumers.findOne({
      where: { usersId: req.user.establishment, id },
      order: [["name", "ASC"]],
    });

    return res.status(200).json(custumer);
  } catch (error) {
    console.error("Erro ao buscar clientes:", error);
    return res.status(500).json({
      message: "Erro ao buscar clientes",
      error: error.message,
    });
  }
});

// Rota para atualizar um cliente
router.put("/customers", auth, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      city,
      bairro,
      state,
      complement,
      observation,
      id,
      birthDate,
      cpf,
      grupo,
      profissao,
      rg,
      status,
    } = req.body;

    console.log("Data recebida:", birthDate); // Debug

    // Verifica se o cliente existe e pertence ao estabelecimento
    const customer = await Custumers.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Se um novo email foi fornecido, verifica se já existe
    if (email && email !== customer.email) {
      const existingCustomer = await Custumers.findOne({
        where: { email },
      });

      if (existingCustomer) {
        return res.status(400).json({
          message: "Email já cadastrado",
        });
      }
    }

    // Trata a data de nascimento
    let formattedBirthDate = null;
    if (birthDate) {
      // Se a data vier como string ISO, mantém como está
      if (birthDate.includes("T")) {
        formattedBirthDate = birthDate;
      } else {
        // Caso contrário, adiciona o horário padrão (meio-dia) para evitar problemas de fuso horário
        formattedBirthDate = `${birthDate}T12:00:00.000Z`;
      }
    }

    // Atualiza os dados do cliente
    const updateData = {
      name: name || customer.name,
      email: email || customer.email,
      phone: phone || customer.phone,
      address: address || customer.address,
      city: city || customer.city,
      state: state || customer.state,
      complement: complement || customer.complement,
      observation: observation || customer.observation,
      birthDate: formattedBirthDate, // Usa a data formatada
      cpf: cpf || customer.cpf,
      status: status !== undefined ? status : customer.status,
    };

    // Include optional new fields
    if (bairro !== undefined) updateData.bairro = bairro || customer.bairro;
    if (grupo !== undefined) updateData.grupo = grupo || customer.grupo;
    if (profissao !== undefined)
      updateData.profissao = profissao || customer.profissao;
    if (rg !== undefined) updateData.rg = rg || customer.rg;

    console.log("Data formatada:", formattedBirthDate); // Debug

    await customer.update(updateData);

    // Busca o cliente atualizado para confirmar os dados
    const updatedCustomer = await Custumers.findByPk(id);
    console.log("Data salva:", updatedCustomer.birthDate); // Debug

    return res.status(200).json({
      message: "Cliente atualizado com sucesso",
      data: updatedCustomer,
    });
  } catch (error) {
    console.error("Erro ao atualizar cliente:", error);
    return res.status(500).json({
      message: "Erro ao atualizar cliente",
      error: error.message,
    });
  }
});

router.get("/birthdays", auth, async (req, res) => {
  try {
    // Pega a data atual no fuso horário de Brasília
    const today = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
    );
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const customersOfTheDay = await Custumers.findAll({
      where: {
        usersId: req.user.establishment,
        birthDate: {
          [Op.not]: null,
        },
        [Op.and]: [
          Sequelize.literal(`EXTRACT(MONTH FROM "birthDate") = ${Number(currentMonth)}`),
          Sequelize.literal(`EXTRACT(DAY FROM "birthDate") = ${Number(currentDay)}`),
        ],
      },
      attributes: ["id", "name", "email", "phone", "birthDate"],
      order: [["name", "ASC"]],
    });

    const petsOfTheDay = await Pets.findAll({
      where: {
        usersId: req.user.establishment,
        birthdate: {
          [Op.not]: null,
        },
        [Op.and]: [
          Sequelize.literal(`EXTRACT(MONTH FROM "birthdate") = ${Number(currentMonth)}`),
          Sequelize.literal(`EXTRACT(DAY FROM "birthdate") = ${Number(currentDay)}`),
        ],
      },
      attributes: ["id", "name", "birthdate", "custumerId"],
      order: [["name", "ASC"]],
    });

    // Buscar dados dos donos dos pets
    const customerIds = [
      ...new Set(
        petsOfTheDay
          .map((pet) => String(pet.custumerId || "").trim())
          .filter((id) => uuidPattern.test(id))
      ),
    ];
    const petOwners = customerIds.length
      ? await Custumers.findAll({
          where: {
            id: {
              [Op.in]: customerIds,
            },
            usersId: req.user.establishment,
          },
          attributes: ["id", "name", "phone"],
        })
      : [];

    // Criar mapa de donos
    const ownerMap = {};
    petOwners.forEach((owner) => {
      ownerMap[owner.id] = {
        name: owner.name,
        phone: owner.phone,
      };
    });

    // Formatar dados dos pets
    const formattedPets = petsOfTheDay.map((pet) => ({
      id: pet.id,
      name: pet.name,
      birthDate: pet.birthdate,
      custumerId: pet.custumerId,
      customerName: ownerMap[pet.custumerId] || "Cliente não encontrado",
    }));

    // Formatar dados dos clientes
    const formattedCustomers = customersOfTheDay.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      birthDate: customer.birthDate,
    }));

    return res.status(200).json({
      message: "Aniversariantes do dia encontrados com sucesso",
      data: {
        customers: formattedCustomers,
        pets: formattedPets,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar aniversariantes:", error);
    return res.status(500).json({
      message: "Erro ao buscar aniversariantes",
      error: error.message,
    });
  }
});

// Rota para obter dados consolidados do cliente
router.get("/customer-data/:customerId", auth, async (req, res) => {
  try {
    const customerId = req.params.customerId;

    // Verifica se o cliente existe e pertence ao estabelecimento
    const customer = await Custumers.findOne({
      where: {
        id: customerId,
        usersId: req.user.establishment,
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Busca todos os agendamentos do cliente
    const appointments = await Appointment.findAll({
      where: { customerId },
      include: [
        {
          model: Services,
          attributes: ["name", "price"],
        },
      ],
      order: [["date", "DESC"]],
    });

    // Busca todas as compras do cliente
    const sales = await Sales.findAll({
      where: { custumerId: customerId },
      order: [["createdAt", "DESC"]],
    });

    // Para cada venda, busca os produtos relacionados
    const salesWithProducts = await Promise.all(
      sales.map(async (sale) => {
        const saleData = sale.toJSON();

        // Busca os itens desta venda
        const saleItems = await SaleItem.findAll({
          where: { saleId: sale.id },
        });

        // Busca os detalhes dos produtos
        const productsDetails = await Promise.all(
          saleItems.map(async (item) => {
            const product = await Product.findOne({
              where: { id: item.productId },
              attributes: ["id", "name"],
            });
            return {
              id: item.productId,
              name: product ? product.name : "Produto não encontrado",
              quantity: item.quantity,
            };
          })
        );

        return {
          ...saleData,
          products: productsDetails,
        };
      })
    );

    // Busca todos os pets do cliente
    const pets = await Pets.findAll({
      where: { custumerId: customerId },
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      message: "Dados do cliente encontrados com sucesso",
      data: {
        customer,
        appointments,
        sales: salesWithProducts,
        pets,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar dados do cliente:", error);
    return res.status(500).json({
      message: "Erro ao buscar dados do cliente",
      error: error.message,
    });
  }
});
// Rota para buscar agendamentos do cliente por CPF e data de nascimento
// Rota para buscar agendamentos do cliente por telefone (versão simplificada - SOMENTE NOMES)
router.get("/client-appointments", auth, async (req, res) => {
  try {
    console.log(req.query);
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        message: "Telefone é obrigatório",
      });
    }

    // Busca o cliente pelo telefone
    const customer = await Custumers.findOne({
      where: {
        phone,
        usersId: req.user.establishment,
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Cliente não encontrado para este telefone",
      });
    }

    // Busca os agendamentos do cliente (SEM INCLUDES para evitar problemas de alias)
    const appointments = await Appointment.findAll({
      where: { customerId: customer.id },
      order: [["date", "DESC"]],
    });

    const appointmentsWithNames = await Promise.all(
      appointments.map(async (appointment) => {
        // Busca os nomes do Pet
        const pet = await Pets.findByPk(appointment.petId, {
          attributes: ["name"], // Busca apenas o nome do pet
        });

        // Busca o nome do Cliente (já temos o customer, podemos usar)
        const customerName = customer.name;

        // Busca o nome do Serviço Principal
        const service = await Services.findByPk(appointment.serviceId, {
          attributes: ["name"], // Busca apenas o nome do serviço
        });

        // Busca o nome do Serviço Secundário (se existir)
        const secondaryService = appointment.secondaryServiceId
          ? await Services.findByPk(appointment.secondaryServiceId, {
              attributes: ["name"], // Busca apenas o nome do serviço secundário
            })
          : null;

        // Busca o nome do Serviço Terciário (se existir)
        const tertiaryService = appointment.tertiaryServiceId
          ? await Services.findByPk(appointment.tertiaryServiceId, {
              attributes: ["name"], // Busca apenas o nome do serviço terciário
            })
          : null;

        return {
          id: appointment.id,
          date: appointment.date,
          time: appointment.time,
          type: appointment.type,
          status: appointment.status,
          observation: appointment.observation,
          petName: pet?.name || "Pet não encontrado", // Nome do Pet
          customerName: customerName, // Nome do Cliente
          serviceName: service?.name || "Serviço Principal não encontrado", // Nome do Serviço Principal
          secondaryServiceName:
            secondaryService?.name || "Serviço Secundário não adicionado", // Nome do Serviço Secundário
          tertiaryServiceName:
            tertiaryService?.name || "Serviço Terciário não adicionado", // Nome do Serviço Terciário
        };
      })
    );

    return res.status(200).json({
      message: "Agendamentos encontrados com sucesso",
      data: appointmentsWithNames,
    });
  } catch (error) {
    console.error("Erro ao buscar agendamentos:", error);
    return res.status(500).json({
      message: "Erro ao buscar agendamentos",
      error: error.message,
    });
  }
});
// Rota para deletar um cliente
router.delete("/client/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verifica se o cliente existe
    const customer = await Custumers.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Cliente não encontrado",
      });
    }

    // Deleta o cliente
    await customer.destroy();

    return res.status(200).json({
      message: "Cliente deletado com sucesso",
    });
  } catch (error) {
    console.error("Erro ao deletar cliente:", error);
    return res.status(500).json({
      message: "Erro ao deletar cliente",
      error: error.message,
    });
  }
});

// Rota para importar clientes
router.post("/customers/import", auth, async (req, res) => {
  try {
    const { customers } = req.body;

    if (!customers || !Array.isArray(customers)) {
      return res.status(400).json({
        success: false,
        message: "Dados inválidos para importação",
      });
    }

    // Validar dados básicos de cada cliente
    const validCustomers = customers
      .filter((customer) => {
        return (
          customer.name &&
          customer.name.trim() !== "" &&
          customer.phone &&
          customer.phone.trim() !== ""
        );
      })
      .map((customer) => {
        // Trata a data de nascimento
        let birthDate = null;
        if (customer.birthDate) {
          if (
            customer.birthDate === "0000-00-00" ||
            customer.birthDate === "Invalid date"
          ) {
            birthDate = null;
          } else {
            try {
              // Tenta converter para o formato YYYY-MM-DD
              const date = new Date(customer.birthDate);
              if (!isNaN(date.getTime())) {
                birthDate = date.toISOString().split("T")[0];
              }
            } catch (error) {
              console.error("Erro ao converter data:", error);
              birthDate = null;
            }
          }
        }

        return {
          ...customer,
          usersId: req.user.establishment,
          status: true,
          birthDate: birthDate, // Será null se inválida
        };
      });

    if (validCustomers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum cliente válido para importação",
      });
    }

    // Importar clientes com tratamento de erro individual
    const results = await Promise.allSettled(
      validCustomers.map((customer) =>
        Custumers.create(customer).catch((error) => {
          console.error("Erro ao criar cliente:", error);
          return null;
        })
      )
    );

    // Contar sucessos e falhas
    const imported = results.filter(
      (r) => r.status === "fulfilled" && r.value
    ).length;
    const failed = validCustomers.length - imported;

    return res.status(200).json({
      success: true,
      message: `${imported} clientes importados com sucesso${
        failed > 0 ? `. ${failed} falharam.` : ""
      }`,
      importedCount: imported,
      failedCount: failed,
    });
  } catch (error) {
    console.error("Erro ao importar clientes:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao importar clientes",
      error: error.message,
    });
  }
});

export default router;
