import { DataTypes } from "sequelize";
import sequelize from "../database/config.js";
const AiWaitlist = sequelize.define("AiWaitlist", {
  id:{type:DataTypes.UUID,defaultValue:DataTypes.UUIDV4,primaryKey:true}, usersId:{type:DataTypes.UUID,allowNull:false},
  conversationId:{type:DataTypes.UUID}, customerId:{type:DataTypes.UUID,allowNull:false}, petId:{type:DataTypes.UUID,allowNull:false}, serviceId:{type:DataTypes.UUID,allowNull:false},
  preferredDates:{type:DataTypes.JSON,allowNull:false,defaultValue:[]}, preferredPeriods:{type:DataTypes.JSON,allowNull:false,defaultValue:[]},
  status:{type:DataTypes.STRING,allowNull:false,defaultValue:"waiting"}, consentAt:{type:DataTypes.DATE,allowNull:false,defaultValue:DataTypes.NOW},
},{tableName:"ai_waitlist",timestamps:true});
export default AiWaitlist;
