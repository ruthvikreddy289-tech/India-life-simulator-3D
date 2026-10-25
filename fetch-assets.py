"""Fetch reproducible licensed source assets; all runtime assets are served locally."""
import json,urllib.request,pathlib,concurrent.futures,subprocess
base=pathlib.Path(__file__).resolve().parents[1]/'dist'
texture_dir=base/'assets/textures';texture_dir.mkdir(parents=True,exist_ok=True)
records=[]
def read(url):
 return subprocess.check_output(['curl','-fLsS','--retry','2','--connect-timeout','20',url])
def fetch_texture(item):
 name,asset=item
 data=json.loads(read('https://api.polyhaven.com/files/'+asset))
 out=[]
 for channel,suffix in [('Diffuse','color'),('nor_gl','normal'),('Rough','roughness')]:
  spec=data[channel]['1k']['jpg']; dest=texture_dir/(name+'-'+suffix+'.jpg');dest.write_bytes(read(spec['url']))
  out.append({'path':str(dest.relative_to(base)),'source':spec['url'],'asset':asset,'license':'CC0-1.0'})
 return out
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(fetch_texture,[('plaster','plastered_wall_04'),('concrete','concrete_floor_02'),('asphalt','asphalt_02'),('paving','concrete_pavement')]):records.extend(result)
from PIL import Image
for path in texture_dir.glob('*.jpg'):
 image=Image.open(path).convert('RGB');image.thumbnail((1024,1024));image.save(path,quality=90 if 'normal' in path.name else 85,optimize=True)
modules={'GLTFLoader.js':'examples/jsm/loaders/GLTFLoader.js','BufferGeometryUtils.js':'examples/jsm/utils/BufferGeometryUtils.js','RGBELoader.js':'examples/jsm/loaders/RGBELoader.js','SkeletonUtils.js':'examples/jsm/utils/SkeletonUtils.js','RoomEnvironment.js':'examples/jsm/environments/RoomEnvironment.js'}
for name,src in modules.items():
 text=read('https://cdn.jsdelivr.net/npm/three@0.160.1/'+src).decode().replace("from 'three'","from './three.module.js'").replace("from '../utils/BufferGeometryUtils.js'","from './BufferGeometryUtils.js'")
 (base/'vendor'/name).write_text(text)
hdr=json.loads(read('https://api.polyhaven.com/files/venice_sunset'))['hdri']['1k']['hdr']
(base/'assets/textures/venice-sunset-1k.hdr').write_bytes(read(hdr['url']))
records.append({'path':'assets/textures/venice-sunset-1k.hdr','source':hdr['url'],'asset':'venice_sunset','license':'CC0-1.0'})
(base/'assets/sources.json').write_text(json.dumps(records,indent=2))
(base/'assets/car/SOURCE.md').write_bytes(read('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/README.md'))
print('Fetched',len(records),'locally bundled texture/environment assets and Three.js loaders.')
