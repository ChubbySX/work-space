import os
from qcloud_cos import CosConfig, CosS3Client
c=CosConfig(Region="ap-shanghai",SecretId=os.environ["COS_SECRET_ID"],SecretKey=os.environ["COS_SECRET_KEY"],Scheme="https")
cl=CosS3Client(c)
r=cl.head_object(Bucket="chubby-website-1515699183",Key="index.html")
print("HEAD 对象元数据:")
print("  Content-Type:", r.get("Content-Type"))
print("  Content-Disposition:", r.get("Content-Disposition"))
print("  Cache-Control:", r.get("Cache-Control"))