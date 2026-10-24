import os
from qcloud_cos import CosConfig, CosS3Client
c=CosConfig(Region="ap-shanghai",SecretId=os.environ["COS_SECRET_ID"],SecretKey=os.environ["COS_SECRET_KEY"],Scheme="https")
cl=CosS3Client(c)
p = "D:/DS harnessw/work station/personal-website/index.html"
with open(p,"rb") as f:
    cl.put_object(Bucket="chubby-website-1515699183",Key="index.html",Body=f,ContentType="text/html; charset=utf-8",ContentDisposition="inline",CacheControl="no-cache, max-age=0")
print("index.html: inline+no-cache OK")
# 顺便检查静态网站托管配置
try:
    w = cl.get_bucket_website(Bucket="chubby-website-1515699183")
    print("静态网站配置:", w)
except Exception as e:
    print("get_bucket_website 失败:", e)