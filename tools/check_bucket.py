import os
from qcloud_cos import CosConfig, CosS3Client
c=CosConfig(Region="ap-shanghai",SecretId=os.environ["COS_SECRET_ID"],SecretKey=os.environ["COS_SECRET_KEY"],Scheme="https")
cl=CosS3Client(c)
b="chubby-website-1515699183"
# 静态网站托管
try:
    w=cl.get_bucket_website(Bucket=b)
    print("静态网站托管:", w)
except Exception as e:
    print("静态网站托管: 未开启或读取失败 -", e)
# 防盗链
try:
    r=cl.get_bucket_referer(Bucket=b)
    print("防盗链:", r)
except Exception as e:
    print("防盗链:", e)
# CORS
try:
    co=cl.get_bucket_cors(Bucket=b)
    print("CORS:", co)
except Exception as e:
    print("CORS: 无或读取失败 -", e)
# 桶概览/权限
try:
    loc=cl.get_bucket_location(Bucket=b)
    print("区域:", loc)
except Exception as e:
    print("区域:", e)