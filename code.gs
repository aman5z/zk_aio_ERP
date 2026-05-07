const SHEET_ID        = "1sbKGknuz6xB1xdohKec4dvnb6Ifvnb6BeDdeklocMgo";
const FOLDER_ID       = "1rgi0M0glLySObvzjVV5B1-NCPkpdul9p";
const ADMIN_EMAIL_CFG = "amanfaizal04@gmail.com";
const WHATSAPP_NUMBER = "917356188530";
const WHATSAPP_APIKEY = "YOUR_API_KEY";
const SESSION_HOURS   = 24;
const MAX_CACHE_TTL_SECONDS = 21600; // Google Apps Script cache max is 6 hours (21600s)
const ALL_PERMS = ["users","dashboard","audit","storage","tokens","tokens.manage","tickets","tickets.manage"];

/* ── ROUTER ── */
function doPost(e) {
  const a = e.parameter.action;
  if (!a && e.parameter.file && e.parameter.name) return publicUploadFallback(e);
  if (a==="login")             return login(e);
  if (a==="getUsers")          return getUsers(e);
  if (a==="addUser")           return addUser(e);
  if (a==="deleteUser")        return deleteUser(e);
  if (a==="updateUserProfile") return updateUserProfile(e);
  if (a==="resetPassword")     return resetPassword(e);
  if (a==="updatePermissions") return updatePermissions(e);
  if (a==="getRoles")          return getRoles(e);
  if (a==="addRole")           return addRole(e);
  if (a==="deleteRole")        return deleteRole(e);
  if (a==="getCounters")       return getCounters(e);
  if (a==="nextToken")         return nextToken(e);
  if (a==="previousToken")     return previousToken(e);
  if (a==="repeatToken")       return repeatToken(e);
  if (a==="addCounter")        return addCounter(e);
  if (a==="renameCounter")     return renameCounter(e);
  if (a==="deleteCounter")     return deleteCounter(e);
  if (a==="resetCounter")      return resetCounter(e);
  if (a==="getTickets")        return getTickets(e);
  if (a==="createTicket")      return createTicket(e);
  if (a==="updateTicket")      return updateTicket(e);
  if (a==="getStorageInfo")    return getStorageInfo(e);
  if (a==="listDriveFiles")    return listDriveFiles(e);
  if (a==="deleteDriveFile")   return deleteDriveFile(e);
  if (a==="uploadDriveFile")   return uploadDriveFile(e);
  if (a==="getDashboard")      return getDashboard(e);
  if (a==="getAuditLog")       return getAuditLog(e);
  if (a==="terminal")          return terminalCommand(e);
  return j("Invalid action");
}
function doGet(e) {
  const a = e && e.parameter && e.parameter.action;
  if (a === "getCountersPublic") return getCountersPublic(e);
  return j("System Online — aman5z.in");
}

/* ── PUBLIC COUNTER READ (no auth, for live display / token.html) ── */
function getCountersPublic(e) {
  ensureCountersSheet();
  const sheet = ss().getSheetByName("Counters");
  const data  = sheet.getDataRange().getValues();
  const rawCb = e && e.parameter && e.parameter.callback;
  // Validate callback name: alphanumeric + underscore only (JSONP safety)
  const cb = rawCb && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawCb) ? rawCb : null;
  if (cb) {
    // JSONP response — wrap data in validated callback function call
    return ContentService
      .createTextOutput(cb + "(" + JSON.stringify(data) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/* ── LOGIN ──
   Users cols: 0=Email 1=Hash 2=Role 3=Phone 4=DisplayName 5=Dept 6=Enabled 7=Modified 8=LastLogon 9=Permissions */
function login(e) {
  const email  = (e.parameter.email || "").trim();
  const pass   = e.parameter.password || "";
  const sheet  = ss().getSheetByName("Users");
  const data   = sheet.getDataRange().getValues();
  const hashed = hash(pass);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][1] === hashed) {
      if (!data[i][6] || String(data[i][6]).toLowerCase() === "false") return j("Account disabled");
      const token  = Utilities.getUuid();
      const expiry = new Date(Date.now() + SESSION_HOURS * 3600000);
      const role   = data[i][2] || "User";
      let perms;
      if (role === "Admin") {
        perms = ALL_PERMS;
      } else {
        try { perms = data[i][9] ? JSON.parse(data[i][9]) : null; } catch(err) { perms = null; }
        if (!perms) perms = defaultPerms(role);
      }
      CacheService.getScriptCache().put(token, JSON.stringify({ email, role, expiry, perms }), Math.min(SESSION_HOURS * 3600, MAX_CACHE_TTL_SECONDS));
      sheet.getRange(i + 1, 9).setValue(new Date());
      auditLog(email, "LOGIN", "Signed in [" + role + "]");
      return ContentService.createTextOutput(JSON.stringify({ token, role, email, perms }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  auditLog(email, "LOGIN_FAILED", "Invalid credentials attempt");
  return j("Invalid credentials");
}
function defaultPerms(role) {
  if (role === "Technician") return ["dashboard","tokens","tokens.manage","tickets","tickets.manage","storage"];
  return ["tokens","tickets"];
}

/* ── USERS ── */
function getUsers(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  return ContentService.createTextOutput(
    JSON.stringify(ss().getSheetByName("Users").getDataRange().getValues())
  ).setMimeType(ContentService.MimeType.JSON);
}
function addUser(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const email = (e.parameter.email||"").trim(), pass = e.parameter.password||"";
  if (!email || !pass) return j("Missing fields");
  const role = e.parameter.role||"User", phone = e.parameter.phone||"";
  const name = e.parameter.displayName||"", dept = e.parameter.department||"";
  let perms = null;
  try { perms = e.parameter.permissions ? JSON.parse(e.parameter.permissions) : null; } catch(err) {}
  const sheet = ss().getSheetByName("Users"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) if (data[i][0] === email) return j("User already exists");
  sheet.appendRow([email, hash(pass), role, phone, name, dept, true, new Date(), "", perms ? JSON.stringify(perms) : ""]);
  auditLog(u.email, "CREATE_USER", "Created: " + email + " [" + role + "]");
  sendWelcomeEmail(email, name||email, role, pass);
  return j("Created");
}
function deleteUser(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const email = e.parameter.email||"";
  if (email === u.email) return j("Cannot delete yourself");
  const sheet = ss().getSheetByName("Users"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) { sheet.deleteRow(i+1); auditLog(u.email,"DELETE_USER","Deleted: "+email); return j("Deleted"); }
  }
  return j("User not found");
}
function updateUserProfile(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const email = e.parameter.email||"";
  const sheet = ss().getSheetByName("Users"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      if (e.parameter.role        !== undefined) sheet.getRange(i+1,3).setValue(e.parameter.role);
      if (e.parameter.phone       !== undefined) sheet.getRange(i+1,4).setValue(e.parameter.phone);
      if (e.parameter.displayName !== undefined) sheet.getRange(i+1,5).setValue(e.parameter.displayName);
      if (e.parameter.department  !== undefined) sheet.getRange(i+1,6).setValue(e.parameter.department);
      if (e.parameter.enabled     !== undefined) sheet.getRange(i+1,7).setValue(e.parameter.enabled==="true");
      sheet.getRange(i+1,8).setValue(new Date());
      const act = e.parameter.enabled!==undefined ? (e.parameter.enabled==="true"?"ENABLE_USER":"DISABLE_USER") : "UPDATE_PROFILE";
      auditLog(u.email, act, "Updated: "+email);
      return j("Updated");
    }
  }
  return j("User not found");
}
function resetPassword(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const email = e.parameter.email||"", pass = e.parameter.password||"";
  if (!email || !pass) return j("Missing fields");
  const sheet = ss().getSheetByName("Users"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      sheet.getRange(i+1,2).setValue(hash(pass));
      sheet.getRange(i+1,8).setValue(new Date());
      auditLog(u.email,"RESET_PASSWORD","Reset PW for: "+email);
      return j("Password reset");
    }
  }
  return j("User not found");
}
function updatePermissions(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const email = e.parameter.email||"";
  const sheet = ss().getSheetByName("Users"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      sheet.getRange(i+1,10).setValue(e.parameter.permissions||"");
      auditLog(u.email,"UPDATE_PERMISSIONS","Permissions updated: "+email);
      return j("Updated");
    }
  }
  return j("User not found");
}

/* ── ROLES ── */
function getRoles(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  ensureRolesSheet();
  return ContentService.createTextOutput(JSON.stringify(ss().getSheetByName("Roles").getDataRange().getValues())).setMimeType(ContentService.MimeType.JSON);
}
function addRole(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  ensureRolesSheet();
  const name = (e.parameter.name||"").trim(), color = e.parameter.color||"#6366f1", desc = e.parameter.description||"";
  if (!name) return j("Missing name");
  const sheet = ss().getSheetByName("Roles"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) if (data[i][0]===name) return j("Role already exists");
  sheet.appendRow([name,color,desc,new Date()]);
  auditLog(u.email,"CREATE_ROLE","Created: "+name);
  return j("Role created");
}
function deleteRole(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const name = e.parameter.name||"";
  if (["Admin","Technician","User"].includes(name)) return j("Cannot delete built-in role");
  const sheet = ss().getSheetByName("Roles"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===name) { sheet.deleteRow(i+1); auditLog(u.email,"DELETE_ROLE","Deleted: "+name); return j("Deleted"); }
  }
  return j("Not found");
}
function ensureRolesSheet() {
  const wb = ss();
  if (!wb.getSheetByName("Roles")) {
    const s = wb.insertSheet("Roles");
    s.appendRow(["Name","Color","Description","Created"]);
    s.appendRow(["Admin","#ef4444","Full system access",new Date()]);
    s.appendRow(["Technician","#22c55e","IT support access",new Date()]);
    s.appendRow(["User","#6b7280","Standard user access",new Date()]);
  }
}

/* ── TOKEN COUNTERS ── */
function getCounters(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  ensureCountersSheet();
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (!data[i][4]) { const p = String.fromCharCode(64+i); sheet.getRange(i+1,5).setValue(p); data[i][4]=p; }
  }
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function nextToken(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) {
      const v = Number(data[i][2])+1;
      sheet.getRange(i+1,3).setValue(v); sheet.getRange(i+1,4).setValue(Utilities.getUuid());
      logCH(data[i][0],data[i][1],data[i][4]+v,u.email,"Next");
      return j({success:true});
    }
  }
  return j({error:"Not found"});
}
function previousToken(e) {
  const u = authPerm(e,"tokens.manage"); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) {
      const v = Math.max(1,Number(data[i][2])-1);
      sheet.getRange(i+1,3).setValue(v); sheet.getRange(i+1,4).setValue(Utilities.getUuid());
      logCH(data[i][0],data[i][1],data[i][4]+v,u.email,"Prev");
      return j({success:true});
    }
  }
  return j({error:"Not found"});
}
function repeatToken(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) {
      sheet.getRange(i+1,4).setValue(Utilities.getUuid());
      logCH(data[i][0],data[i][1],data[i][4]+data[i][2],u.email,"Repeat");
      return j({success:true});
    }
  }
  return j({error:"Not found"});
}
function addCounter(e) {
  const u = authPerm(e,"tokens.manage"); if (!u) return j("Unauthorized");
  ensureCountersSheet();
  const sheet = ss().getSheetByName("Counters");
  const cnt = sheet.getDataRange().getValues().length-1;
  const name = e.parameter.name||"Counter";
  sheet.appendRow([Utilities.getUuid(),name,1,Utilities.getUuid(),String.fromCharCode(65+cnt)]);
  auditLog(u.email,"CREATE_COUNTER","Created: "+name);
  return j({success:true});
}
function renameCounter(e) {
  const u = authPerm(e,"tokens.manage"); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) { sheet.getRange(i+1,2).setValue(e.parameter.newName); return j({success:true}); }
  }
  return j({error:"Not found"});
}
function deleteCounter(e) {
  const u = authPerm(e,"tokens.manage"); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) { auditLog(u.email,"DELETE_COUNTER","Deleted: "+data[i][1]); sheet.deleteRow(i+1); return j({success:true}); }
  }
  return j({error:"Not found"});
}
function resetCounter(e) {
  const u = authPerm(e,"tokens.manage"); if (!u) return j("Unauthorized");
  const sheet = ss().getSheetByName("Counters"), data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.counterId) {
      sheet.getRange(i+1,3).setValue(1); sheet.getRange(i+1,4).setValue(Utilities.getUuid());
      auditLog(u.email,"RESET_COUNTER","Reset: "+data[i][1]); return j({success:true});
    }
  }
  return j({error:"Not found"});
}
function ensureCountersSheet() {
  const wb = ss();
  if (!wb.getSheetByName("Counters")) { const s=wb.insertSheet("Counters"); s.appendRow(["ID","Name","Value","UpdatedKey","Prefix"]); }
  if (!wb.getSheetByName("CounterHistory")) { const s=wb.insertSheet("CounterHistory"); s.appendRow(["ID","Name","Value","User","Action","Timestamp"]); }
}
function logCH(id,name,val,user,action) {
  try { const s=ss().getSheetByName("CounterHistory"); if(s) s.appendRow([id,name,val,user,action,new Date()]); } catch(err) {}
}

/* ── TICKETS ── */
function getTickets(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  ensureTicketsSheet();
  return ContentService.createTextOutput(JSON.stringify(ss().getSheetByName("Tickets").getDataRange().getValues())).setMimeType(ContentService.MimeType.JSON);
}
function createTicket(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  ensureTicketsSheet();
  const sheet = ss().getSheetByName("Tickets");
  const tid   = "TCK-"+new Date().getFullYear()+"-"+("0000"+sheet.getLastRow()).slice(-4);
  const pri   = e.parameter.priority||"Low", name = e.parameter.requesterName||u.email;
  const title = e.parameter.title||"(No title)", desc = e.parameter.description||"";
  const slaH  = pri==="High"?4:pri==="Medium"?12:24;
  const due   = new Date(Date.now()+slaH*3600000);
  sheet.appendRow([tid,new Date(),u.email,u.email,title,desc,pri,"Open","Unassigned",new Date(),slaH,due,"",name]);
  auditLog(u.email,"CREATE_TICKET",tid+" ["+pri+"] "+title);
  try {
    const pc = pri==="High"?"#ef4444":pri==="Medium"?"#f59e0b":"#22c55e";
    const html = "<div style='font-family:Segoe UI,Arial;max-width:540px;'><div style='background:#1e4fa0;padding:16px 20px;border-radius:6px 6px 0 0;'><h2 style='color:#fff;margin:0;font-size:17px;'>🎫 "+tid+"</h2></div><div style='background:#f9fafb;padding:16px;border:1px solid #e5e7eb;border-top:none;font-size:13px;'><b>From:</b> "+name+"<br><b>Priority:</b> <span style='background:"+pc+";color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;'>"+pri+"</span><br><b>Title:</b> "+title+"<br><br>"+desc+"</div></div>";
    MailApp.sendEmail({to:ADMIN_EMAIL_CFG,subject:"🎫 "+tid+" ["+pri+"] "+title,body:title+"\n\n"+desc,htmlBody:html});
  } catch(err) { Logger.log("Ticket email: "+err.message); }
  if (WHATSAPP_APIKEY&&WHATSAPP_APIKEY!=="YOUR_API_KEY") { try{UrlFetchApp.fetch("https://api.callmebot.com/whatsapp.php?phone="+WHATSAPP_NUMBER+"&text="+encodeURIComponent("🎫 "+tid+" | "+pri+" | "+name)+"&apikey="+WHATSAPP_APIKEY);}catch(err){} }
  return j("Ticket Created: "+tid);
}
function updateTicket(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  if (u.role!=="Admin" && !(u.perms||[]).includes("tickets.manage")) return j("Insufficient permissions");
  const sheet = ss().getSheetByName("Tickets"), data = sheet.getDataRange().getValues();
  if (!e.parameter.status && !e.parameter.assignedTo) return j("Nothing to update");
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]===e.parameter.ticketId) {
      const changes=[];
      if (e.parameter.status)    {sheet.getRange(i+1,8).setValue(e.parameter.status);    changes.push("status="+e.parameter.status);}
      if (e.parameter.assignedTo){sheet.getRange(i+1,9).setValue(e.parameter.assignedTo);changes.push("assignedTo="+e.parameter.assignedTo);}
      sheet.getRange(i+1,10).setValue(new Date());
      auditLog(u.email,"UPDATE_TICKET",e.parameter.ticketId+": "+changes.join(", "));
      return j("Updated");
    }
  }
  return j("Not found");
}
function ensureTicketsSheet() {
  if (!ss().getSheetByName("Tickets")) {
    const s = ss().insertSheet("Tickets");
    s.appendRow(["TicketID","Created","CreatedBy","Email","Title","Description","Priority","Status","AssignedTo","LastUpdated","SLAHours","DueTime","Attachment","RequesterName"]);
  }
}

/* ── STORAGE ── */
function getStorageInfo(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  try { const used=DriveApp.getStorageUsed(),limit=2*1024*1024*1024*1024;
    return ContentService.createTextOutput(JSON.stringify({used,limit,usedGB:(used/1073741824).toFixed(2),limitTB:2,percent:((used/limit)*100).toFixed(2)})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) { return j("Error: "+err.message); }
}
function listDriveFiles(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  const fid = e.parameter.folderId||FOLDER_ID;
  try {
    const folder=DriveApp.getFolderById(fid);
    const result={name:folder.getName(),id:fid,files:[],folders:[]};
    const files=folder.getFiles();
    while(files.hasNext()){const f=files.next();result.files.push({id:f.getId(),name:f.getName(),size:f.getSize(),mimeType:f.getMimeType(),modified:f.getLastUpdated().toISOString(),url:f.getUrl()});}
    const subs=folder.getFolders();
    while(subs.hasNext()){const s=subs.next();result.folders.push({id:s.getId(),name:s.getName()});}
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err){return ContentService.createTextOutput(JSON.stringify({error:err.message})).setMimeType(ContentService.MimeType.JSON);}
}
function deleteDriveFile(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  try { const f=DriveApp.getFileById(e.parameter.fileId); auditLog(u.email,"DELETE_FILE",f.getName()); f.setTrashed(true); return j("Deleted"); }
  catch(err){return j("Error: "+err.message);}
}
function uploadDriveFile(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  try {
    const name=e.parameter.fileName||"upload",b64=e.parameter.fileData||"",mime=e.parameter.mimeType||"application/octet-stream",fid=e.parameter.folderId||FOLDER_ID;
    const file=DriveApp.getFolderById(fid).createFile(Utilities.newBlob(Utilities.base64Decode(b64),mime,name));
    auditLog(u.email,"UPLOAD_FILE",name);
    return ContentService.createTextOutput(JSON.stringify({id:file.getId(),name:file.getName(),url:file.getUrl()})).setMimeType(ContentService.MimeType.JSON);
  } catch(err){return j("Error: "+err.message);}
}

function publicUploadFallback(e) {
  const u = authAny(e); if (!u) return ContentService.createTextOutput("Error: Unauthorized");
  try {
    const name = e.parameter.name || "upload";
    const b64 = e.parameter.file || "";
    const mime = e.parameter.mimeType || "application/octet-stream";
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, name);
    const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) { /* Ignore restricted domain policy */ }
    return ContentService.createTextOutput(file.getUrl());
  } catch(err) {
    return ContentService.createTextOutput("Error: Exception: " + err.message);
  }
}

/* ── DASHBOARD ── */
function getDashboard(e) {
  const u = authAny(e); if (!u) return j("Unauthorized");
  const wb=ss(),users=wb.getSheetByName("Users").getDataRange().getValues().slice(1).filter(r=>r[0]);
  const byRole={};
  users.forEach(r=>{const role=r[2]||"Unknown";byRole[role]=(byRole[role]||0)+1;});
  let ts={total:0,open:0,closed:0,resolved:0,overdue:0};
  try{const tickets=wb.getSheetByName("Tickets").getDataRange().getValues().slice(1).filter(r=>r[0]);ts.total=tickets.length;ts.open=tickets.filter(r=>r[7]==="Open").length;ts.closed=tickets.filter(r=>r[7]==="Closed").length;ts.resolved=tickets.filter(r=>r[7]==="Resolved").length;ts.overdue=tickets.filter(r=>r[7]==="Open"&&new Date()>new Date(r[11])).length;}catch(err){}
  let ra=[];
  try{const al=wb.getSheetByName("AuditLog");if(al)ra=al.getDataRange().getValues().slice(1).slice(-10).reverse().map(r=>({time:r[0]?new Date(r[0]).toISOString():"",actor:r[1]||"",action:r[2]||"",detail:r[3]||""}));}catch(err){}
  return ContentService.createTextOutput(JSON.stringify({users:{total:users.length,byRole,enabled:users.filter(r=>r[6]!==false).length,disabled:users.filter(r=>r[6]===false).length},tickets:ts,recentAudit:ra})).setMimeType(ContentService.MimeType.JSON);
}

/* ── AUDIT ── */
function auditLog(actor,action,detail) {
  try{const wb=ss();if(!wb.getSheetByName("AuditLog")){const s=wb.insertSheet("AuditLog");s.appendRow(["Timestamp","Actor","Action","Detail"]);s.setFrozenRows(1);}wb.getSheetByName("AuditLog").appendRow([new Date(),actor,action,detail]);}
  catch(err){Logger.log("Audit error: "+err.message);}
}
function getAuditLog(e) {
  const u = authPerm(e,"audit"); if (!u) return j("Unauthorized");
  try{const s=ss().getSheetByName("AuditLog");if(!s)return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);return ContentService.createTextOutput(JSON.stringify(s.getDataRange().getValues())).setMimeType(ContentService.MimeType.JSON);}
  catch(err){return j("Error: "+err.message);}
}

/* ── TERMINAL ── */
function terminalCommand(e) {
  const u = auth(e,"Admin"); if (!u) return j("Unauthorized");
  const cmd=(e.parameter.command||"").trim().toLowerCase(),wb=ss();
  const TBL={users:"Users",tickets:"Tickets",roles:"Roles",counters:"Counters",audit:"AuditLog",counterhistory:"CounterHistory"};
  if(cmd==="help") return j(["Commands:","  help  whoami  clear","  show tables  show storage  show audit","  describe <table>","  select * from users/tickets/roles/counters/audit","  select * from users where role=Admin","  count users/tickets/counters","  find user <email>"].join("\n"));
  if(cmd==="whoami") return j(u.email+" ["+u.role+"]");
  if(cmd==="clear")  return j("__clear__");
  if(cmd==="show tables") return j(wb.getSheets().map(s=>s.getName()).join("\n"));
  if(cmd==="show audit"){const al=wb.getSheetByName("AuditLog");if(!al)return j("No audit log.");return j(al.getDataRange().getValues().slice(1).slice(-10).reverse().map(r=>"["+new Date(r[0]).toLocaleString("en-GB")+"] "+r[1]+" → "+r[2]+": "+r[3]).join("\n"));}
  if(cmd.startsWith("show storage")){try{const u2=DriveApp.getStorageUsed();return j((u2/1073741824).toFixed(2)+" GB / 2048 GB ("+(u2/(2*1099511627776)*100).toFixed(2)+"%)");}catch(err){return j("Drive error: "+err.message);}}
  if(cmd.startsWith("select * from ")){const rest=cmd.replace("select * from ","").trim();const parts=rest.split(" where ");const tName=parts[0].trim();const sName=TBL[tName]||(tName.charAt(0).toUpperCase()+tName.slice(1));const sheet=wb.getSheetByName(sName);if(!sheet)return j("Table not found: "+tName);return tableOutput(sheet.getDataRange().getValues(),parts[1]?parseWhere(parts[1]):null);}
  if(cmd.startsWith("count ")){const tName=cmd.replace("count ","").trim();const sName=TBL[tName]||(tName.charAt(0).toUpperCase()+tName.slice(1));try{return j((wb.getSheetByName(sName).getDataRange().getValues().length-1)+" row(s) in "+tName);}catch(err){return j("Not found: "+tName);}}
  if(cmd.startsWith("describe ")){const tName=cmd.replace("describe ","").trim();const sName=TBL[tName]||(tName.charAt(0).toUpperCase()+tName.slice(1));try{return j(wb.getSheetByName(sName).getDataRange().getValues()[0].map((h,i)=>"  ["+i+"] "+h).join("\n"));}catch(err){return j("Not found");}}
  if(cmd.startsWith("find user ")){const search=cmd.replace("find user ","").trim();const found=wb.getSheetByName("Users").getDataRange().getValues().filter((r,i)=>i>0&&(r[0]||"").toLowerCase().includes(search));return j(!found.length?"No users matching: "+search:found.map(r=>"  "+r[0]+" | "+r[2]+" | "+(r[4]||"—")).join("\n"));}
  return j("Unknown command. Type 'help'.");
}
function parseWhere(s){const m=s.match(/(\w+)\s*=\s*(\S+)/i);return m?{col:m[1].toLowerCase(),val:m[2].toLowerCase()}:null;}
function tableOutput(data,where){if(!data||data.length<2)return j("No data");const h=data[0];let rows=data.slice(1);if(where){const ci=h.findIndex(x=>(x||"").toLowerCase()===where.col);if(ci>=0)rows=rows.filter(r=>(r[ci]||"").toString().toLowerCase()===where.val);}if(!rows.length)return j("No rows matched");return j("("+rows.length+" rows)\n"+rows.map(r=>h.map((x,i)=>x+": "+(r[i]||"")).join(" | ")).join("\n"));}

/* ── WELCOME EMAIL ── */
function sendWelcomeEmail(email,displayName,role,tempPass){
  try{MailApp.sendEmail({to:email,subject:"🏢 Welcome to aman5z.in — Your Account is Ready",body:"Account: "+email+"\nPassword: "+tempPass+"\nRole: "+role+"\n\nChange your password after first login.",htmlBody:"<div style='font-family:Segoe UI,Arial;max-width:520px;margin:0 auto;'><div style='background:linear-gradient(135deg,#1e4fa0,#0f3580);padding:20px;border-radius:6px 6px 0 0;text-align:center;'><h1 style='color:#fff;font-size:18px;margin:0;'>🏢 Welcome to aman5z.in</h1></div><div style='background:#f9fafb;padding:18px;border:1px solid #e5e7eb;'><p style='color:#374151;margin:0 0 12px;'>Hi <strong>"+displayName+"</strong>, your account is ready:</p><table style='font-size:13px;width:100%;border-collapse:collapse;'><tr style='background:#e8edf8;'><td style='padding:8px 10px;font-weight:600;'>Account</td><td style='padding:8px 10px;'>"+email+"</td></tr><tr><td style='padding:8px 10px;font-weight:600;'>Password</td><td style='padding:8px 10px;font-family:monospace;'>"+tempPass+"</td></tr><tr style='background:#e8edf8;'><td style='padding:8px 10px;font-weight:600;'>Role</td><td style='padding:8px 10px;'>"+role+"</td></tr></table><p style='margin:12px 0 0;background:#fff3cd;color:#856404;padding:8px;border-radius:4px;font-size:12px;'>⚠️ Change your password after first login.</p></div></div>"});
  }catch(err){Logger.log("Welcome email failed: "+err.message);}
}

/* ── HELPERS ── */
function ss(){return SpreadsheetApp.openById(SHEET_ID);}
function j(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function hash(pw){const raw=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,pw);return raw.map(b=>(b<0?b+256:b).toString(16).padStart(2,"0")).join("");}
function auth(e,role){const s=CacheService.getScriptCache().get(e.parameter.token||"");if(!s)return null;try{const p=JSON.parse(s);if(new Date()>new Date(p.expiry))return null;if(role&&p.role!==role)return null;return p;}catch(err){return null;}}
function authAny(e){const s=CacheService.getScriptCache().get(e.parameter.token||"");if(!s)return null;try{const p=JSON.parse(s);if(new Date()>new Date(p.expiry))return null;return p;}catch(err){return null;}}
function authPerm(e,perm){const u=authAny(e);if(!u)return null;if(u.role==="Admin"||(u.perms||[]).includes(perm))return u;return null;}

/* ── ONE-TIME SETUP ── */
function authorizeNow(){const f=DriveApp.getFolderById(FOLDER_ID);Logger.log("Drive OK: "+f.getName()+" | Storage: "+(DriveApp.getStorageUsed()/1073741824).toFixed(2)+" GB");}
function authorizeMailNow(){MailApp.sendEmail({to:ADMIN_EMAIL_CFG,subject:"✅ Mail Auth Test",body:"Mail authorized for aman5z.in"});Logger.log("Sent to: "+ADMIN_EMAIL_CFG);}
function migrateUsersSheet(){
  const sheet=ss().getSheetByName("Users"),data=sheet.getDataRange().getValues();
  const needed=["Phone","DisplayName","Department","AccountEnabled","LastModified","LastLogon","Permissions"];
  const cur=data[0].length;
  for(let i=cur;i<10;i++)sheet.getRange(1,i+1).setValue(needed[i-3]||"Col"+i);
  for(let i=1;i<data.length;i++){if(data[i][6]==="")sheet.getRange(i+1,7).setValue(true);if(!data[i][7])sheet.getRange(i+1,8).setValue(new Date());}
  Logger.log("Migration done. Headers: "+ss().getSheetByName("Users").getDataRange().getValues()[0].join(", "));
}