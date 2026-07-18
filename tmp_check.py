import requests
urls = ['https://api.smartcareervai.com/config','https://api.smartcareervai.com/pay-premium','https://smart-career-vai.vercel.app']
for u in urls:
    try:
        r = requests.get(u, timeout=20)
        print(u, '=>', r.status_code)
        print(r.text[:200])
    except Exception as e:
        print(u, '=> ERROR', e)
