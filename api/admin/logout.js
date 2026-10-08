import { api } from "../_lib/core.js";
import { clearAdminCookie } from "../_lib/admin-auth.js";
export default api(["POST"],async(_req,res)=>{
 clearAdminCookie(res);return res.status(200).json({authenticated:false});
});