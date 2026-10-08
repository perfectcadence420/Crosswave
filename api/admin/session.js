import { api,ApiError } from "../_lib/core.js";
import { requireAdmin } from "../_lib/admin-auth.js";
export default api(["GET"],async(req,res)=>{
 try{requireAdmin(req);return res.status(200).json({authenticated:true})}
 catch(e){if(e instanceof ApiError&&e.status===401)return res.status(200).json({authenticated:false});throw e}
});