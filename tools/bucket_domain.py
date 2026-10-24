import os
from qcloud_cos import CosConfig, CosS3Client
c=CosConfig(Region="ap-shanghai",SecretId=os.environ["COS_SECRET_ID"],SecretKey=os.environ["COS_SECRET_KEY"],Scheme="https")
cl=CosS3Client(c)
b="chubby-website-1515699183"
for m in ["get_bucket_domain","get_bucket_cdn","get_bucket_lifecycle"]:
    try:
        r=getattr(cl,m)(Bucket=b)
        print(f"{m}: {r}")
    except Exception as e:
        print(f"{m}: 不存在/失败 - {str(e)[:80]}")