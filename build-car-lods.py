"""Reproduce mobile LODs from the attributed CarConcept source.
Run: blender --background --python tools/build-car-lods.py
The original asset remains unchanged. Medium retains the interior; distant LOD
removes interior detail. CC BY 4.0 attribution is in assets/CREDITS.md.
"""
import bpy, pathlib, math, json, struct, subprocess, shutil
# Blender's exporter may reuse original packed pixels despite image.scale().
# Repack each embedded image after export to enforce the actual mobile budget.
REPACK = r"""
import sys,json,struct,io,pathlib
from PIL import Image
path=pathlib.Path(sys.argv[1]);limit=int(sys.argv[2]);data=path.read_bytes()
length=struct.unpack_from('<I',data,12)[0];g=json.loads(data[20:20+length]);old=data[20+length+8:]
image_views={im['bufferView']:im for im in g.get('images',[]) if 'bufferView' in im}
new=bytearray()
for index,view in enumerate(g['bufferViews']):
 raw=old[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 if index in image_views:
  image=Image.open(io.BytesIO(raw));image.thumbnail((limit,limit),Image.Resampling.LANCZOS)
  stream=io.BytesIO()
  if image.mode in ('RGBA','LA'):
   image.save(stream,format='PNG',optimize=True);image_views[index]['mimeType']='image/png'
  else:
   image.convert('RGB').save(stream,format='JPEG',quality=86,optimize=True);image_views[index]['mimeType']='image/jpeg'
  raw=stream.getvalue()
 while len(new)%4:new.append(0)
 view['byteOffset']=len(new);view['byteLength']=len(raw);view['buffer']=0;new.extend(raw)
g['buffers'][0]['byteLength']=len(new)
while len(new)%4:new.append(0)
js=json.dumps(g,separators=(',',':')).encode()
while len(js)%4:js+=b' '
body=struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(new),0x004e4942)+new
path.write_bytes(struct.pack('<III',0x46546c67,2,12+len(body))+body)
"""
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=next((p for p in [ROOT/'dist/assets/car/car.glb',ROOT/'asset-sources/car.glb',ROOT/'assets-source/car.glb',ROOT/'sources/car-original.glb'] if p.exists()),ROOT/'dist/assets/car/car.glb')

def build(filename, ratio, limit, distant=False):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for datablocks in [bpy.data.meshes,bpy.data.materials,bpy.data.images]:
        for datablock in list(datablocks):
            if datablock.users==0: datablocks.remove(datablock)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH': continue
        # Small unseen interior parts and the source logos are omitted at distance.
        if distant and (obj.name.startswith('Interior') or obj.name in ['Engine','License Plate'] or 'Emblem' in obj.name or 'Wiper' in obj.name):
            bpy.data.objects.remove(obj,do_unlink=True)
            continue
        tris=sum(max(0,len(p.vertices)-2) for p in obj.data.polygons)
        if tris>24:
            modifier=obj.modifiers.new('Mobile mesh reduction','DECIMATE')
            modifier.ratio=max(ratio,18/max(1,tris))
            modifier.use_collapse_triangulate=True
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in obj.data.polygons:
            polygon.use_smooth=True
    for image in bpy.data.images:
        if not image.has_data or image.size[0]==0: continue
        scale=min(1,limit/max(image.size))
        if scale<1: image.scale(max(1,round(image.size[0]*scale)),max(1,round(image.size[1]*scale)))
        # Exporter can consume the resized packed pixels directly.
        image.pack()
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        for node in mat.node_tree.nodes:
            if node.type!='BSDF_PRINCIPLED':continue
            if 'Transmission Weight' in node.inputs:
                node.inputs['Transmission Weight'].default_value=0
            if 'Coat Weight' in node.inputs:
                node.inputs['Coat Weight'].default_value=min(.25,node.inputs['Coat Weight'].default_value)
            if 'Iridescence Weight' in node.inputs:
                node.inputs['Iridescence Weight'].default_value=0
            if 'Glass' in mat.name:
                node.inputs['Base Color'].default_value=(.08,.15,.19,1)
                node.inputs['Alpha'].default_value=.24
                mat.surface_render_method='DITHERED'
    path=ROOT/'dist/assets/car'/filename
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,
        export_apply=True,export_animations=False,export_cameras=False,export_lights=False,
        export_image_format='JPEG',export_jpeg_quality=84,export_materials='EXPORT')
    subprocess.run([shutil.which('python3'),'-c',REPACK,str(path),str(limit)],check=True)
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+length])
    triangles=sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'] if 'indices' in p)
    print('LOD_RESULT',json.dumps({'file':filename,'triangles':triangles,'bytes':len(data),'texture_limit':limit,'interior':not distant}),flush=True)

build('car-player.glb',.35,1024)
build('car-lod.glb',.105,512)
build('car-low.glb',.045,256,True)
