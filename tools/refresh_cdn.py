import os
from tencentcloud.common import credential
from tencentcloud.cdn.v20180606 import cdn_client, models
cred = credential.Credential(os.environ["COS_SECRET_ID"], os.environ["COS_SECRET_KEY"])
client = cdn_client.CdnClient(cred, "")
req = models.PurgeUrlsCacheRequest()
req.Urls = ["https://chubby-website-1515699183.cos-website.ap-shanghai.myqcloud.com/"]
try:
    resp = client.PurgeUrlsCache(req)
    print("CDN刷新结果:", resp)
except Exception as e:
    print("CDN刷新失败(可能未走CDN):", e)