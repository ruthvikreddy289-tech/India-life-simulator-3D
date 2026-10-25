"""Original India Life district architecture. Run with Blender 3.4+:
blender --background --python tools/build-district.py -- dist/assets/architecture
Authored for this project; source and exported geometry released under MIT.
Axes: Blender Z-up, front -Y; glTF Y-up, front +Z. Units are metres.
All plaster/concrete meshes have metre-based UVs for externally supplied PBR maps.
"""
import bpy, math, sys, os
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
OUT=os.path.abspath(args[0] if args else 'dist/assets/architecture')
os.makedirs(OUT,exist_ok=True)

def mat(name,color,rough=.7,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m
M={}
for name,col,rough,metal in [
 ('PLASTER',(0.77,.66,.49),.85,0),('PLASTER_LIGHT',(.86,.81,.67),.8,0),('CONCRETE',(.47,.46,.4),.95,0),
 ('TERRACOTTA',(.6,.31,.19),.8,0),('METAL',(.2,.25,.25),.5,.65),('GLASS',(.13,.28,.31),.2,.35),
 ('AWNING',(.08,.37,.34),.8,0),('CREAM',(.91,.83,.64),.7,0),('TANK',(.12,.15,.17),.65,0),
 ('WOOD',(.32,.2,.12),.75,0),('SIGN',(.93,.87,.69),.6,0),('SHUTTER',(.33,.4,.39),.7,.45)]:M[name]=mat(name,col,rough,metal)

def finish(obj,name,material):
    obj.name=name;obj.data.materials.append(M[material])
    # World-unit UV projections avoid stretched tile textures on long slabs.
    if obj.type=='MESH':
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        if not obj.data.uv_layers:obj.data.uv_layers.new(name='UVMap')
        uv=obj.data.uv_layers.active.data
        for poly in obj.data.polygons:
            axis=max(range(3),key=lambda i:abs(poly.normal[i]))
            for li in poly.loop_indices:
                co=obj.data.vertices[obj.data.loops[li].vertex_index].co
                a,b=((co.y,co.z) if axis==0 else (co.x,co.z) if axis==1 else (co.x,co.y))
                uv[li].uv=(a/3,b/3)
    return obj

def cube(name,loc,scale,ma='PLASTER',bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=scale;finish(o,name,ma)
    if bevel:
        mod=o.modifiers.new('soft worn edges','BEVEL');mod.width=bevel;mod.segments=2
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons:p.use_smooth=False
    return o

def cyl(name,loc,radius,depth,ma='METAL',verts=16,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=radius,depth=depth,location=loc);o=bpy.context.object
    if rot:o.rotation_euler=rot
    finish(o,name,ma)
    for p in o.data.polygons:p.use_smooth=True
    return o

def cable(points,r=.025):
    curve=bpy.data.curves.new('service cable','CURVE');curve.dimensions='3D';curve.bevel_depth=r;curve.bevel_resolution=1
    poly=curve.splines.new('POLY');poly.points.add(len(points)-1)
    for p,co in zip(poly.points,points):p.co=(*co,1)
    o=bpy.data.objects.new('overhead electrical cable',curve);bpy.context.collection.objects.link(o);o.data.materials.append(M['METAL'])
    bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)

def text(label,x,y,z,size=.8):
    bpy.ops.object.text_add(location=(x,y,z),rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.body=label;o.data.size=size;o.data.extrude=.008;o.data.materials.append(M['SIGN']);bpy.ops.object.convert(target='MESH');o.name='raised shop lettering'

def window(x,y,z,w=2,h=2.05,medium=False,side=False):
    # Glass is recessed behind the structural facade, framed in depth.
    glass=cube('recessed dark glass',(x,y+.13,z),(w,.045,h),'GLASS')
    for d in [-1,1]:
        cube('window jamb',(x+d*(w/2+.06),y-.035,z),(.12,.23,h+.24),'CREAM')
        cube('window sill lintel',(x,y-.035,z+d*(h/2+.06)),(w+.24,.23,.12),'CREAM')
    cube('central mullion',(x,y-.07,z),(.07,.18,h),'METAL')
    if not medium:cube('transom',(x,y-.08,z-.15),(w,.14,.06),'METAL')

def balcony(x,y,z,width,medium):
    cube('projecting balcony slab',(x,y-.8,z-1.22),(width,1.75,.18),'CONCRETE',.03 if not medium else 0)
    cube('balcony top rail',(x,y-1.6,z-.26),(width,.075,.075),'METAL')
    cube('balcony lower rail',(x,y-1.6,z-.83),(width,.065,.065),'METAL')
    for side in [-1,1]:
        cube('balcony side rail',(x+side*(width/2-.05),y-.8,z-.26),(.075,1.6,.075),'METAL')
    step=.55 if not medium else width/2
    for i in range(int(width/step)+1):cube('balcony baluster',(x-width/2+i*step,y-1.6,z-.72),(.045,.045,.92),'METAL')

def ac(x,y,z,medium):
    cube('AC condenser casing',(x,y-.35,z),(.95,.65,.65),'CREAM',.03 if not medium else 0)
    if not medium:
        cyl('AC fan grille',(x,y-.69,z),.23,.03,'METAL',16,(math.pi/2,0,0))
        for a in range(4):
            blade=cube('fan vane',(x,y-.72,z),(.04,.025,.37),'TANK');blade.rotation_euler.y=a*math.pi/4
        cable([(x+.5,y,z),(x+.7,y,z),(x+.7,y,z+.8)],.025)

def building(kind,medium):
    heritage=kind=='heritage-shop';apartment=kind=='apartment';station=kind=='station'
    w,d=(32,16) if station else (22,18)
    levels=1 if station else 3 if heritage else 7 if apartment else 4
    story=3.3;ground=4.1;height=ground+levels*story
    front=-d/2
    # Side/rear structural shell, with no opaque wall covering front windows.
    cube('rear structural wall',(0,d/2-.2,height/2),(w,.4,height),'PLASTER')
    for s in [-1,1]:
        cube('side structural wall',(s*(w/2-.2),0,height/2),(.4,d,height),'PLASTER')
    for n in range(levels+1):
        z=ground+n*story
        cube('floor slab',(0,0,z),(w+.25,d+.25,.2),'CONCRETE')
        cube('facade floor band',(0,front-.08,z),(w+.5,.42,.36),'CREAM')
    for n in range(levels):
        z=ground+n*story+story/2
        # Openings formed between wall piers rather than painted on a cube.
        centres=[-7.2,0,7.2] if not station else [-11,-5.5,0,5.5,11]
        opening=2.6 if not station else 3.2
        last=-w/2
        for centre in centres:
            edge=centre-opening/2-.12
            if edge>last:cube('solid wall between recessed openings',((last+edge)/2,front,z),(edge-last,.42,story),'PLASTER_LIGHT' if heritage else 'PLASTER')
            last=centre+opening/2+.12
        if last<w/2:cube('end wall pier',((last+w/2)/2,front,z),(w/2-last,.42,story),'PLASTER')
        cube('infill below windows',(0,front,z-1.25),(w,.4,.8),'PLASTER')
        cube('infill above windows',(0,front,z+1.4),(w,.4,.5),'PLASTER')
        for x in centres:
            window(x,front-.1,z,w=2.6 if not station else 3.2,medium=medium)
            if n%2==0 and not station:balcony(x,front-.1,z,3.3,medium)
            if not medium and n%2==1:ac(x+1.8,front-.2,z-.8,medium)
        # Side windows with concrete surrounds; black recess and frames.
        for side in [-1,1]:
            for yy in [-5,0,5]:
                cube('side window recessed',(side*(w/2+.02),yy,z),(.05,1.7,1.9),'GLASS')
                for dy in [-1,1]:cube('side window jamb',(side*(w/2+.08),yy+dy*.92,z),(.18,.12,2.15),'CREAM')
                for dz in [-1,1]:cube('side window sill',(side*(w/2+.08),yy,z+dz*1.01),(.18,2,.12),'CREAM')
    # Ground level has multiple shop bays, a separate entrance, and roll shutters.
    bays=5 if station else 3
    for i in range(bays):
        x=(i-(bays-1)/2)*(w-1)/bays;bw=(w-2)/bays-.3
        cube('shopfront recess',(x,front+.22,1.6),(bw,.06,2.9),'GLASS' if i%2==0 or station else 'SHUTTER')
        for s in [-1,1]:cube('shop door jamb',(x+s*(bw/2+.08),front-.1,1.75),(.2,.36,3.5),'CREAM')
        cube('shop header',(x,front-.12,3.5),(bw+.4,.4,.25),'CREAM')
        if i%2 and not medium:
            for zz in range(16):cube('rolling shutter rib',(x,front+.12,.22+zz*.18),(bw,.1,.035),'METAL')
        else:
            cube('glass door mullion',(x,front+.09,1.6),(.08,.1,2.9),'METAL')
            cube('brass door handle',(x+.25,front-.03,1.5),(.04,.1,.45),'SIGN')
    cube('signboard',(0,front-.2,3.7),(w-.5,.25,.6),'AWNING')
    text('KONKAN CENTRAL' if station else 'SEA VIEW RESIDENCY' if apartment else 'SAHYADRI STORES' if heritage else 'UDUPI CAFE  |  APNA MART',-w/2+.8,front-.36,3.5,.56 if not station else .8)
    awning=cube('fabric canopy',(0,front-.95,3.22),(w+.7,2,.12),'TERRACOTTA' if heritage else 'AWNING');awning.rotation_euler.x=.12
    if not medium:
        for x in range(-int(w/2),int(w/2),2):cube('awning ribs',(x,front-.95,3.3),(.05,2,.04),'METAL')
        cable([(-w/2,front-.4,4.3),(-w/4,front-.6,4.05),(0,front-.6,4),(w/4,front-.6,4.05),(w/2,front-.4,4.3)],.025)
    # Cornices, roof slab, full parapet and rooftop utilities.
    cube('cornice lower',(0,0,height+.1),(w+.8,d+.8,.35),'CREAM')
    cube('roof slab',(0,0,height+.4),(w+.2,d+.2,.25),'CONCRETE')
    for side in [-1,1]:
        cube('roof front parapet',(0,side*(d/2-.12),height+1),(w,.22,1.2),'PLASTER_LIGHT')
        cube('roof side parapet',(side*(w/2-.12),0,height+1),(.22,d,1.2),'PLASTER_LIGHT')
    cube('roof access cabin',(w/2-3,2,height+1.5),(4,4,2.8),'PLASTER')
    cube('roof cabin door',(w/2-3,-.05,height+1.3),(1.1,.06,2.1),'WOOD')
    for x in [-5,1]:
        cube('tank stand',(x,3,height+.8),(2.5,2.5,.8),'CONCRETE')
        cyl('water tank',(x,3,height+2.2),1.25,2.3,'TANK',12 if medium else 24)
        cyl('water tank lid',(x,3,height+3.4),1.3,.12,'TANK',12 if medium else 24)
        if not medium:
            for dz in [-.7,0,.7]:cyl('tank strengthening band',(x,3,height+2.2+dz),1.28,.06,'METAL',24)
            cyl('tank vent',(x,3,height+3.7),.08,.5,'METAL',8)
    if heritage:
        # Pilasters and decorative brackets distinguish the older market frontage.
        for x in [-10,-3.5,3.5,10]:
            cube('heritage pilaster',(x,front-.3,height/2),(.35,.5,height),'CREAM')
            cube('pilaster capital',(x,front-.3,height-.5),(.75,.7,.5),'CREAM')
        for x in range(-10,11,2):cube('cornice corbel',(x,front-.25,height-.3),(.32,.8,.5),'TERRACOTTA')
    if station:
        # A clock tower and shaded forecourt denote the railway entrance.
        cube('station tower',(0,2,height+2),(5,5,5),'PLASTER_LIGHT')
        cube('tower clock face',(0,-.54,height+2.6),(1.7,.05,1.7),'CREAM')
        cube('clock minute hand',(0,-.59,height+2.9),(.04,.04,.65),'METAL')
        hand=cube('clock hour hand',(.15,-.59,height+2.65),(.4,.04,.04),'METAL');hand.rotation_euler.y=-.6
        for x in [-13,-6.5,6.5,13]:cyl('forecourt column',(x,front-2.5,1.8),.15,3.6,'METAL',12)
        cube('station portico roof',(0,front-2,3.7),(w+2,5,.23),'AWNING')

def office(medium):
    w,d,h=22,18,30
    cube('recessed service core',(0,1,h/2),(13,10,h),'CONCRETE')
    cube('stone lobby plinth',(0,0,.45),(24,20,.9),'CONCRETE')
    for n in range(9):
        z=4+n*3.15
        cube('expressed concrete floor',(0,0,z),(22.5,18.5,.22),'CREAM')
    # Reflective curtain walls sit outside the structure, with inset glazing,
    # aluminium mullions and shadow-producing horizontal fins.
    for side in [-1,1]:
        for x in range(-10,11,2):
            cube('curtain wall glass',(x,side*9.03,16),(1.85,.07,23.6),'GLASS')
            cube('vertical aluminium mullion',(x-1,side*9.13,16),(.08,.17,24),'METAL')
            if not medium:
                for z in [7.1,13.4,19.7,26]:cube('recessed curtainwall transom',(x,side*9.15,z),(2,.18,.07),'METAL')
        for yy in range(-8,9,2):
            cube('side curtain wall glazing',(side*11.03,yy,16),(.07,1.85,23.6),'GLASS')
            cube('side vertical mullion',(side*11.13,yy-1,16),(.17,.08,24),'METAL')
        for z in [7.2,10.35,13.5,16.65,19.8,22.95,26.1]:
            cube('facade shading fin',(0,side*9.4,z),(23,.8,.12),'CREAM')
            cube('side shading fin',(side*11.4,0,z),(.8,19,.12),'CREAM')
    cube('lobby clear glass',(0,-9.06,2.35),(20,.08,3.5),'GLASS')
    for x in [-8,-4,0,4,8]:
        cube('lobby structural mullion',(x,-9.2,2.35),(.14,.28,3.7),'METAL')
        if not medium:cube('entrance door handles',(x+.3,-9.3,1.8),(.04,.14,.65),'SIGN')
    cube('floating entrance canopy',(0,-10.2,4.2),(14,3.2,.22),'AWNING')
    cube('office entrance step',(0,-10.7,.25),(13,3.5,.5),'CONCRETE')
    cube('office sign fascia',(0,-9.2,5.5),(21,.22,1.1),'AWNING')
    text('KONKAN TECH PARK',-8.9,-9.36,5.15,.82)
    cube('roof mechanical deck',(0,0,30.3),(23,19,.5),'CONCRETE')
    for side in [-1,1]:
        cube('roof guard parapet',(0,side*9,31),(22,.25,1.3),'METAL')
        cube('side roof guard',(side*11,0,31),(.25,18,1.3),'METAL')
    for x in [-6,0,6]:
        cube('roof HVAC condenser',(x,2,31.1),(4,5,1.6),'CREAM')
        if not medium:
            for yy in [1,3]:
                cyl('HVAC axial fan',(x,yy,31.94),.8,.08,'METAL',20)
                for angle in range(6):
                    fan=cube('HVAC fan blade',(x,yy,32),(.08,1.35,.035),'TANK');fan.rotation_euler.z=angle*math.pi/3
            for yy in [0,1,2,3,4]:cube('HVAC side louvre',(x-2.02,yy,31.1),(.04,.12,1.2),'METAL')
    if not medium:
        for x in [-10,10]:cyl('lobby bollard',(x,-10.6,.85),.1,1.1,'METAL',12)

def hotel(medium):
    w,d,h=20,18,33
    cube('hotel rear structure',(0,.3,16.5),(20,17.4,33),'PLASTER_LIGHT')
    for z in [4.5,8,11.5,15,18.5,22,25.5,29,32.7]:cube('hotel facade floor band',(0,0,z),(20.5,18.4,.19),'CREAM')
    for level in range(8):
        z=6.2+level*3.45
        for x in [-7.6,-3.8,0,3.8,7.6]:
            window(x,-9.18,z,w=1.45,h=2.15,medium=medium)
            if x in [-7.6,7.6] and level%2==0:balcony(x,-9.3,z,2.7,medium)
            if not medium and level%2==1:ac(x+1.15,-9.15,z-.45,medium)
        for side in [-1,1]:
            for yy in [-5,0,5]:
                cube('narrow side hotel glazing',(side*10.06,yy,z),(.06,1.45,2.2),'GLASS')
                if not medium:
                    for dz in [-1,1]:cube('hotel side window frame',(side*10.12,yy,z+dz*1.15),(.18,1.65,.1),'CREAM')
    cube('hotel lobby glazing',(0,-9.23,2.2),(17,.07,3.7),'GLASS')
    for x in [-8,-4,0,4,8]:cube('hotel lobby door frame',(x,-9.35,2.2),(.12,.25,3.9),'METAL')
    cube('porte cochere floating roof',(0,-11.2,4.4),(18,5.8,.35),'TERRACOTTA')
    for x in [-8,8]:
        for yy in [-9.5,-13.3]:cyl('hotel stone entry column',(x,yy,2.2),.19,4.4,'CREAM',12)
    cube('entry step one',(0,-11,.15),(17,5,.3),'CONCRETE')
    cube('hotel entrance sign',(0,-9.35,5.05),(16,.25,.9),'AWNING')
    text('THE MALABAR HOTEL',-7.2,-9.51,4.8,.65)
    cube('vertical HOTEL signboard',(9.2,-9.65,23.5),(1.3,.3,9.5),'AWNING')
    if not medium:
        for i,letter in enumerate('HOTEL'):text(letter,8.84,-9.84,26.6-i*1.65,.95)
    cube('rooftop terrace',(0,0,33.1),(21,19,.4),'CONCRETE')
    for side in [-1,1]:
        cube('hotel roof parapet',(0,side*9,33.8),(20,.24,1.4),'CREAM')
        cube('hotel side roof parapet',(side*10,0,33.8),(.24,18,1.4),'CREAM')
    for x in [-7,0,7]:
        cube('rooftop planting trough',(x,-6,33.9),(4,2,1.1),'TERRACOTTA')
        if not medium:
            for dx in [-1.3,0,1.3]:
                cyl('rooftop decorative plant trunk',(x+dx,-6,34.9),.07,1.4,'WOOD',8)
                cyl('rooftop clipped shrub',(x+dx,-6,35.5),.65,.85,'AWNING',10)
    cube('hotel lift overrun',(3,2,34.8),(5,5,3),'PLASTER')
    for x in [-6,-1]:
        cube('hotel roof AC plant',(x,3,34),(3,4,1.4),'CREAM')
        if not medium:
            for zz in [33.5,33.9,34.3]:cube('hotel HVAC louvre',(x,1,zz),(2.6,.08,.1),'METAL')

def export(kind,medium):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    if kind=='office':office(medium)
    elif kind=='hotel':hotel(medium)
    else:building(kind,medium)
    # Merge by material to keep glTF primitives compact and instancing efficient.
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    bymat={}
    for o in objects:bymat.setdefault(o.data.materials[0].name,[]).append(o)
    for ma,obs in bymat.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();obs[0].name=kind+'_'+ma
    bpy.ops.object.select_all(action='SELECT')
    path=os.path.join(OUT,kind+('-medium' if medium else '')+'.glb')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_texcoords=True,export_materials='EXPORT')
    print('EXPORTED',path)
for kind in (args[1:] or ['corner-shop','apartment','heritage-shop','station','office','hotel']):
    for medium in [False,True]:export(kind,medium)
