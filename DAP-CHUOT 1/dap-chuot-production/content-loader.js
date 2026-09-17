// Production content is provided only by the authenticated server.
const unavailable=()=>{throw Error('Nội dung được quản lý trên máy chủ.');};
export const sourceConfig=unavailable, saveSource=unavailable, loadQuestionBank=unavailable, validateBank=unavailable;
