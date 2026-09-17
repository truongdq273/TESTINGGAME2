// IT changes only this file when using its authenticated WebSocket gateway.
export const runtimeConfig = Object.freeze({mode:'server',socketPath:'/classroom/v1/socket',allowedContentHosts:['docs.google.com']});
export function assertRuntime(){
 if(!['demo','server'].includes(runtimeConfig.mode))throw Error('Cấu hình chế độ game không hợp lệ.');
 if(runtimeConfig.mode==='demo'&&!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw Error('Bản mô phỏng chỉ chạy trên máy local. Đội IT cần cấu hình chế độ server và cổng kết nối trước khi sử dụng trực tuyến.');
}
