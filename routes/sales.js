import express from "express";
import auth from "../middlewares/auth.js";
import { Op } from "sequelize";
import sequelize from "../database/config.js";
import Users from "../models/Users.js";
// Import models after defining them to avoid circular dependencies
const router = express.Router();

// Import models after router definition
import Sales from "../models/Sales.js";
import SaleItem from "../models/SaleItem.js";
import Custumers from "../models/Custumers.js";
import Products from "../models/Products.js";
import Finance from "../models/Finance.js";

// Rota para criar uma nova venda
router.post("/sales", auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { custumerId, items, paymentMethod, observation, appointmentId } =
      req.body;
    const idUser = req.user.id;
    const establishment = req.user.establishment;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Adicione pelo menos um item para concluir a venda",
      });
    }

    // Verifica se o cliente existe e pertence ao estabelecimento
    if (custumerId) {
      const customer = await Custumers.findOne({
        where: {
          id: custumerId,
          usersId: establishment,
        },
      });

      if (!customer) {
        return res.status(404).json({
          message: "Cliente não encontrado",
        });
      }
    }

    // Calcula o total da venda
    const total = items.reduce((acc, item) => {
      return acc + item.price * item.quantify;
    }, 0);

    // Cria a venda
    const sale = await Sales.create(
      {
        usersId: establishment,
        responsible: idUser,
        custumerId,
        appointmentId,
        total,
        paymentMethod,
        status: "pendente",
        observation,
      },
      { transaction: t },
    );

    // Cria os itens da venda e atualiza estoque se necessário
    const saleItems = await Promise.all(
      items.map(async (item) => {
        const subTotal = item.price * item.quantify;

        // Verifica se o produto é unitário e atualiza o estoque
        const product = await Products.findOne({
          where: {
            id: item.productId,
            usersId: establishment,
          },
          transaction: t,
        });
        if (!product) {
          throw new Error("Produto nao encontrado para este estabelecimento");
        }
        if (product.unitary && Number(product.stoke || 0) < Number(item.quantify || 0)) {
          throw new Error(`Estoque insuficiente para o produto ${product.name}`);
        }
        if (product.unitary) {
          await Products.update(
            { stoke: sequelize.literal(`stoke - ${item.quantify}`) },
            {
              where: {
                id: item.productId,
                usersId: establishment,
              },
              transaction: t,
            },
          );
        }

        return SaleItem.create(
          {
            usersId: establishment,
            saleId: sale.id,
            productId: item.productId,
            quantify: item.quantify,
            price: item.price,
            subTotal,
            observation: item.observation,
          },
          { transaction: t },
        );
      }),
    );
    const customer = await Custumers.findOne({
      where: {
        id: custumerId,
        usersId: establishment,
      },
    });

    // Cria a transação financeira
    await Finance.create(
      {
        type: "entrada",
        description: `Venda - ${customer.name || "Cliente não identificado"}`,
        amount: total,
        date: new Date(),
        dueDate: new Date(), // Data de vencimento igual à data atual para vendas pagas
        category: "Vendas",
        paymentMethod: paymentMethod,
        status: "pendente",
        reference: sale.id,
        createdBy: req.user.id,
        usersId: req.user.establishment,
      },
      { transaction: t },
    );

    await t.commit();

    return res.status(201).json({
      message: "Venda realizada com sucesso",
      data: {
        sale,
        items: saleItems,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Erro ao criar venda:", error);
    return res.status(500).json({
      message: "Erro ao criar venda",
      error: error.message,
    });
  }
});

// Rota para listar todas as vendas
router.get("/sales", auth, async (req, res) => {
  try {
    const sales = await Sales.findAll({
      where: { usersId: req.user.establishment },
      include: [
        {
          model: Custumers,
          attributes: ["name", "phone"],
        },
        {
          model: SaleItem,
          attributes: ["productId", "quantify", "price", "subTotal"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Buscar os nomes dos produtos para cada venda
    const salesWithProducts = await Promise.all(
      sales.map(async (sale) => {
        const saleJSON = sale.toJSON();
        saleJSON.SaleItems = await Promise.all(
          saleJSON.SaleItems.map(async (item) => {
            const product = await Products.findOne({
              where: {
                id: item.productId,
                usersId: req.user.establishment,
              },
              attributes: ["name"],
            });
            return {
              ...item,
              productName: product ? product.name : null,
            };
          }),
        );
        return saleJSON;
      }),
    );

    return res.status(200).json({
      message: "Vendas encontradas com sucesso",
      data: salesWithProducts,
    });
  } catch (error) {
    console.error("Erro ao buscar vendas:", error);
    return res.status(500).json({
      message: "Erro ao buscar vendas",
      error: error.message,
    });
  }
});
// Rota para buscar uma venda específica
router.get("/sales/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await Sales.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
      include: [
        {
          model: Custumers,
          attributes: ["name", "phone", "email"],
        },
        {
          model: SaleItem,
          attributes: [
            "productId",
            "quantify",
            "price",
            "subTotal",
            "observation",
          ],
        },
      ],
    });

    if (!sale) {
      return res.status(404).json({
        message: "Venda não encontrada",
      });
    }

    // Buscar informações do responsável manualmente
    const responsible = await Users.findByPk(sale.responsible, {
      attributes: ["name", "email"],
    });

    // Buscar os nomes dos produtos para cada item da venda
    const saleWithProductNames = {
      ...sale.toJSON(),
      seller: responsible
        ? {
            name: responsible.name,
            email: responsible.email,
          }
        : null,
      SaleItems: await Promise.all(
        sale.SaleItems.map(async (item) => {
          const product = await Products.findOne({
            where: {
              id: item.productId,
              usersId: req.user.establishment,
            },
            attributes: ["name"],
          });
          return {
            ...item.toJSON(),
            productName: product ? product.name : null,
          };
        }),
      ),
    };

    return res.status(200).json({
      message: "Venda encontrada com sucesso",
      data: saleWithProductNames,
    });
  } catch (error) {
    console.error("Erro ao buscar venda:", error);
    return res.status(500).json({
      message: "Erro ao buscar venda",
      error: error.message,
    });
  }
});

// Rota para atualizar o status de uma venda
router.patch("/sales/:id/status", auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    const sale = await Sales.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
      include: [
        {
          model: SaleItem,
          attributes: ["productId", "quantify"],
        },
        {
          model: Custumers,
          attributes: ["name"],
        },
      ],
    });

    if (!sale) {
      return res.status(404).json({
        message: "Venda não encontrada",
      });
    }

    // Atualiza o status da venda
    await sale.update({ status }, { transaction: t });

    // Busca a transação financeira relacionada
    const financeRecord = await Finance.findOne({
      where: {
        reference: sale.id,

        usersId: req.user.establishment,
      },
    });

    // Gerencia a transação financeira
    if (financeRecord) {
      // Se já existe uma transação, apenas atualiza o status
      await Finance.update(
        { status },
        {
          where: {
            id: financeRecord.id,
            usersId: req.user.establishment,
          },
          transaction: t,
        },
      );
    } else if (status === "pago") {
      // Se não existe transação e o status é 'pago', cria uma nova
      await Finance.create(
        {
          type: "entrada",
          description: `Venda - ${sale.Custumer?.name || "Cliente não identificado"}`,
          amount: sale.total,
          date: new Date(),
          dueDate: new Date(), // Data de vencimento igual à data atual para vendas pagas
          category: "Vendas",
          paymentMethod: sale.paymentMethod,
          status: "pago",
          reference: sale.id,
          createdBy: req.user.id,
          usersId: req.user.establishment,
        },
        { transaction: t },
      );
    }

    await t.commit();

    return res.status(200).json({
      message: "Status da venda atualizado com sucesso",
      data: sale,
    });
  } catch (error) {
    await t.rollback();
    console.error("Erro ao atualizar status da venda:", error);
    return res.status(500).json({
      message: "Erro ao atualizar status da venda",
      error: error.message,
    });
  }
});

// Rota para buscar vendas por cliente
router.get("/sales/customer/:customerId", auth, async (req, res) => {
  try {
    const { customerId } = req.params;

    const sales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        custumerId: customerId,
      },
      include: [
        {
          model: SaleItem,
          attributes: ["productId", "quantify", "price", "subTotal"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Buscar os nomes dos produtos e do cliente para cada venda
    const salesWithNames = await Promise.all(
      sales.map(async (sale) => {
        const saleJSON = sale.toJSON(); // Converte para JSON para facilitar a manipulação

        // Busca o nome do cliente
        const customer = await Custumers.findByPk(sale.custumerId, {
          attributes: ["name"],
        });
        saleJSON.customerName = customer ? customer.name : null; // Adiciona customerName

        // Busca os nomes dos produtos para cada SaleItem
        saleJSON.SaleItems = await Promise.all(
          saleJSON.SaleItems.map(async (item) => {
            const product = await Products.findByPk(item.productId, {
              attributes: ["name"],
            });
            return {
              ...item,
              productName: product ? product.name : null, // Adiciona productName a cada SaleItem
            };
          }),
        );
        return saleJSON;
      }),
    );

    return res.status(200).json({
      message: "Vendas encontradas com sucesso",
      data: salesWithNames,
    });
  } catch (error) {
    console.error("Erro ao buscar vendas do cliente:", error);
    return res.status(500).json({
      message: "Erro ao buscar vendas do cliente",
      error: error.message,
    });
  }
});

// Rota para obter estatísticas de vendas do dia
router.get("/sales/stats/today", auth, async (req, res) => {
  try {
    // Define início e fim do dia atual
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Busca todas as vendas não canceladas
    const allSales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        status: {
          [Op.ne]: "cancelado",
        },
      },
    });

    // Busca vendas do dia
    const todaySales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        createdAt: {
          [Op.between]: [startOfDay, endOfDay],
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
    });

    // Busca vendas pendentes
    const pendingSales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        status: "pendente",
      },
    });

    // Busca vendas canceladas
    const canceledSales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        status: "cancelado",
      },
    });

    // Calcula estatísticas
    const totalSales = todaySales.length;
    const totalValue = todaySales.reduce(
      (acc, sale) => acc + Number(sale.total),
      0,
    );
    const averageTicket = totalSales > 0 ? totalValue / totalSales : 0;

    const totalAllSales = allSales.length;
    const totalAllValue = allSales.reduce(
      (acc, sale) => acc + Number(sale.total),
      0,
    );

    const pendingSalesCount = pendingSales.length;
    const pendingValue = pendingSales.reduce(
      (acc, sale) => acc + Number(sale.total),
      0,
    );

    const canceledSalesCount = canceledSales.length;
    const canceledValue = canceledSales.reduce(
      (acc, sale) => acc + Number(sale.total),
      0,
    );

    // Agrupa vendas por método de pagamento
    const paymentMethods = todaySales.reduce((acc, sale) => {
      acc[sale.paymentMethod] =
        (acc[sale.paymentMethod] || 0) + Number(sale.total);
      return acc;
    }, {});

    return res.status(200).json({
      message: "Estatísticas encontradas com sucesso",
      data: {
        totalSales,
        totalValue,
        averageTicket,
        totalAllSales,
        totalAllValue,
        pendingSales: pendingSalesCount,
        pendingValue,
        canceledSales: canceledSalesCount,
        canceledValue,
        paymentMethods,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error);
    return res.status(500).json({
      message: "Erro ao buscar estatísticas",
      error: error.message,
    });
  }
});

// Rota para obter resumo financeiro do período
router.get("/sales/stats/period", auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const sales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        createdAt: {
          [Op.between]: [start, end],
        },
        status: {
          [Op.ne]: "cancelado",
        },
      },
    });

    const totalValue = sales.reduce((acc, sale) => acc + Number(sale.total), 0);
    const averageTicket = sales.length > 0 ? totalValue / sales.length : 0;

    return res.status(200).json({
      message: "Resumo financeiro encontrado com sucesso",
      data: {
        period: {
          start,
          end,
        },
        totalSales: sales.length,
        totalValue,
        averageTicket,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar resumo financeiro:", error);
    return res.status(500).json({
      message: "Erro ao buscar resumo financeiro",
      error: error.message,
    });
  }
});

// Rota para obter produtos vencidos
router.get("/sales/products/expired", auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Assumindo que você tem um modelo Products com campo expirationDate
    const expiredProducts = await Products.findAll({
      where: {
        usersId: req.user.establishment,
        expirationDate: {
          [Op.lte]: today,
        },
      },
      attributes: ["id", "name", "expirationDate", "stoke", "price"],
    });

    // Calcula valor total dos produtos vencidos
    const totalLoss = expiredProducts.reduce((acc, product) => {
      return acc + Number(product.price) * product.stoke;
    }, 0);

    return res.status(200).json({
      message: "Produtos vencidos encontrados com sucesso",
      data: {
        products: expiredProducts,
        totalLoss,
        count: expiredProducts.length,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar produtos vencidos:", error);
    return res.status(500).json({
      message: "Erro ao buscar produtos vencidos",
      error: error.message,
    });
  }
});

// Rota para buscar vendas por agendamento
router.get("/sales/appointment/:appointmentId", auth, async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const sales = await Sales.findAll({
      where: {
        usersId: req.user.establishment,
        appointmentId,
      },
      include: [
        {
          model: SaleItem,
          attributes: ["productId", "quantify", "price", "subTotal"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    // Buscar os nomes dos produtos para cada item das vendas
    const salesWithProductNames = await Promise.all(
      sales.map(async (sale) => {
        const saleWithItems = sale.toJSON();
        saleWithItems.SaleItems = await Promise.all(
          sale.SaleItems.map(async (item) => {
            const product = await Products.findByPk(item.productId, {
              attributes: ["name", "imageUrl"],
            });
            return {
              ...item.toJSON(),
              productName: product ? product.name : null,
              productImage: product ? product.imageUrl : null,
            };
          }),
        );
        return saleWithItems;
      }),
    );

    return res.status(200).json({
      message: "Vendas do agendamento encontradas com sucesso",
      data: salesWithProductNames,
    });
  } catch (error) {
    console.error("Erro ao buscar vendas do agendamento:", error);
    return res.status(500).json({
      message: "Erro ao buscar vendas do agendamento",
      error: error.message,
    });
  }
});

// Update sale status
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const sale = await Sale.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });
    if (!sale) {
      return res.status(404).json({ message: "Venda não encontrada" });
    }

    sale.status = status;
    await sale.save();

    res.json({ message: "Status da venda atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar status da venda:", error);
    res.status(500).json({ message: "Erro ao atualizar status da venda" });
  }
});
// Delete sale
router.delete("/sales/:id", auth, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;

    const sale = await Sales.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!sale) {
      return res.status(404).json({
        message: "Venda não encontrada",
      });
    }

    // Get sale items
    const saleItems = await SaleItem.findAll({
      where: {
        saleId: id,
      },
    });

    // If sale was paid, return items to stock
    if (sale.status === "pago") {
      await Promise.all(
        saleItems.map(async (item) => {
          const product = await Products.findOne({
            where: {
              id: item.productId,
              usersId: req.user.establishment,
            },
          });
          if (product && product.unitary) {
            await Products.update(
              { stoke: sequelize.literal(`stoke + ${item.quantify}`) },
              {
                where: {
                  id: item.productId,
                  usersId: req.user.establishment,
                },
                transaction: t,
              },
            );
          }
        }),
      );

      // Delete associated finance record if exists
      await Finance.destroy({
        where: {
          reference: `sale_${sale.id}`,
          usersId: req.user.establishment,
        },
        transaction: t,
      });
    }

    // Delete sale items first
    await SaleItem.destroy({
      where: { saleId: id },
      transaction: t,
    });

    // Delete the sale
    await sale.destroy({ transaction: t });

    await t.commit();

    return res.status(200).json({
      message: "Venda excluída com sucesso",
    });
  } catch (error) {
    await t.rollback();
    console.error("Erro ao excluir venda:", error);
    return res.status(500).json({
      message: "Erro ao excluir venda",
      error: error.message,
    });
  }
});

export default router;
