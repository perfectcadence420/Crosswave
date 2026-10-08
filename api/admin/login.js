import { api,jsonBody,ApiError } from "../_lib/core.js";
import { validPassword,issueAdminCookie } from "../_lib/admin-auth.js";
export default api(["POST"],async(req,res)=>{
 const {password}=jsonBody(req);
 if(!validPassword(password))throw new ApiError(401,"Incorrect password");
 issueAdminCookie(res);return res.status(200).json({authenticated:true});
});