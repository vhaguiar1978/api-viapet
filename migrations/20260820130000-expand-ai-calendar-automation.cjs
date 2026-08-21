"use strict";
module.exports = {
  async up(q, S) {
    const tables = (await q.showAllTables()).map(String).map(x => x.toLowerCase());
    const common = { id:{type:S.UUID,allowNull:false,primaryKey:true}, usersId:{type:S.UUID,allowNull:false}, createdAt:{type:S.DATE,allowNull:false,defaultValue:S.fn("NOW")}, updatedAt:{type:S.DATE,allowNull:false,defaultValue:S.fn("NOW")} };
    if(!tables.includes("ai_calendar_approvals")) await q.createTable("ai_calendar_approvals", {...common,conversationId:{type:S.UUID},customerId:{type:S.UUID},petId:{type:S.UUID},appointmentId:{type:S.UUID},action:{type:S.STRING,allowNull:false},status:{type:S.STRING,allowNull:false,defaultValue:"pending"},payload:{type:S.JSON,allowNull:false,defaultValue:{}},requestedAt:{type:S.DATE,allowNull:false,defaultValue:S.fn("NOW")},decidedAt:{type:S.DATE},decidedBy:{type:S.UUID},decisionNotes:{type:S.TEXT}});
    if(!tables.includes("ai_calendar_action_logs")) await q.createTable("ai_calendar_action_logs", {...common,conversationId:{type:S.UUID},customerId:{type:S.UUID},petId:{type:S.UUID},appointmentId:{type:S.UUID},action:{type:S.STRING,allowNull:false},permissionMode:{type:S.STRING,allowNull:false},previousData:{type:S.JSON,allowNull:false,defaultValue:{}},newData:{type:S.JSON,allowNull:false,defaultValue:{}},confirmedByCustomer:{type:S.BOOLEAN,allowNull:false,defaultValue:false},approvedByUserId:{type:S.UUID},model:{type:S.STRING},toolCalled:{type:S.STRING},status:{type:S.STRING,allowNull:false},error:{type:S.TEXT},undoneAt:{type:S.DATE}});
    if(!tables.includes("ai_waitlist")) await q.createTable("ai_waitlist", {...common,conversationId:{type:S.UUID},customerId:{type:S.UUID,allowNull:false},petId:{type:S.UUID,allowNull:false},serviceId:{type:S.UUID,allowNull:false},preferredDates:{type:S.JSON,allowNull:false,defaultValue:[]},preferredPeriods:{type:S.JSON,allowNull:false,defaultValue:[]},status:{type:S.STRING,allowNull:false,defaultValue:"waiting"},consentAt:{type:S.DATE,allowNull:false}});
    const a=await q.describeTable("appointments");
    for(const [n,d] of Object.entries({createdByType:{type:S.STRING,allowNull:false,defaultValue:"user"},createdByAi:{type:S.BOOLEAN,allowNull:false,defaultValue:false},aiActionLogId:{type:S.UUID},aiOverbooking:{type:S.BOOLEAN,allowNull:false,defaultValue:false}})) if(!a[n]) await q.addColumn("appointments",n,d);
  },
  async down(q){
    const a=await q.describeTable("appointments");
    for(const n of ["aiOverbooking","aiActionLogId","createdByAi","createdByType"]) if(a[n]) await q.removeColumn("appointments",n);
    for(const t of ["ai_waitlist","ai_calendar_action_logs","ai_calendar_approvals"]){try{await q.dropTable(t)}catch{}}
  }
};
