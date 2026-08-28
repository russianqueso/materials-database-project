import streamlit as st
import plotly.express as px
from mp_api.client import MPRester
import pandas as pd
import plotly.graph_objects as go

st.set_page_config(page_title="Materials Explorer", layout="wide")
st.title("Materials Science Dashboard")
st.markdown("Screen real materials from the Materials Project database")

# --- Sidebar ---
api_key = st.secrets.get("MP_API_KEY", None)

# Presets
st.sidebar.subheader("Quick Presets")
is_metal = st.sidebar.checkbox("Only metals (zero band gap)", value=False)
preset = st.sidebar.selectbox("Load a preset", [
    "None (custom)", 
    "Battery Materials (Li-containing, stable)",
    "Solar Cell Absorbers (1-2 eV gap, stable)",
    "Magnets / Metals (zero gap)",
    "Oxides Only (O-containing, stable)"
    
])

max_elements = st.sidebar.slider("Max elements", 1, 5, 3)
min_gap = st.sidebar.slider("Min band gap (eV)", 0.0, 10.0, 0.0)
max_gap = st.sidebar.slider("Max band gap (eV)", 0.0, 10.0, 10.0)
elements = st.sidebar.text_input("Must contain elements (e.g., Li, O, Fe)", placeholder="Li,O")
only_stable = st.sidebar.checkbox("Only stable materials", value=False)
chunk_size = st.sidebar.slider("Max results", 100, 2000, 500)

# Apply presets
if preset == "Battery Materials (Li-containing, stable)":
    elements = "Li"
    only_stable = True
    min_gap, max_gap = 0.0, 5.0
elif preset == "Solar Cell Absorbers (1-2 eV gap, stable)":
    min_gap, max_gap = 1.0, 2.0
    only_stable = True
elif preset == "Magnets / Metals (zero gap)":
    min_gap, max_gap = 0.0, 0.1
elif preset == "Oxides Only (O-containing, stable)":
    elements = "O"
    only_stable = True
if is_metal:
    min_gap, max_gap = 0.0, 0.1
load_button = st.sidebar.button("Load Materials", type="primary")

# --- Fetch Data ---
if load_button:
    if not api_key or len(api_key.strip()) == 0:
        st.error("Paste your API key first.")
        st.stop()
    
    key_clean = api_key.strip()
    st.info(f"Querying with key ...{key_clean[-4:]}")
    
    with st.spinner("Fetching data..."):
        try:
            with MPRester(key_clean) as mpr:
                # Build query
                query = {
                    "num_elements": (1, max_elements),
                    "band_gap": (min_gap, max_gap),
                    "fields": ["material_id", "formula_pretty", "band_gap",
                               "density", "volume", "structure","symmetry", "energy_above_hull",
                               "is_stable", "elements"],
                    "num_chunks": 1,
                    "chunk_size": chunk_size
                }
                
                # Add stability filter
                if only_stable:
                    query["energy_above_hull"] = (0, 0.05)
                
                # Add element filter
                if elements.strip():
                    query["elements"] = [e.strip() for e in elements.split(",")]
                
                docs = mpr.materials.summary.search(**query)
            
            if len(docs) == 0:
                st.warning("No materials match those filters.")
                st.stop()
            structures = {}
            data = []
            if d.structure:
                structures[d.formula_pretty] = d.structure
            for d in docs:
                data.append({
                    "Material ID": d.material_id,
                    "Formula": d.formula_pretty,
                    "Band Gap (eV)": round(d.band_gap, 3) if d.band_gap is not None else 0,
                    "Density (g/cm³)": round(d.density, 3) if d.density is not None else 0,
                    "Volume (Å³)": round(d.volume, 2) if d.volume is not None else 0,
                    "Crystal System": d.symmetry.crystal_system if d.symmetry else "Unknown",
                    "Energy Above Hull (eV/atom)": round(d.energy_above_hull, 4) if d.energy_above_hull is not None else 0,
                    "Stable": "✅ Yes" if d.is_stable else "❌ No"
                })
            
            df = pd.DataFrame(data)
            st.session_state.df = df
            st.session_state.structures = structures
            st.success(f"Loaded {len(df)} materials!")
            
        except Exception as e:
            st.error(f"API Error: {e}")
            st.stop()

# --- Display ---
if "df" in st.session_state:
    df = st.session_state.df
    
    # Stats
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total", len(df))
    c2.metric("Stable", (df["Stable"] == "✅ Yes").sum())
    c3.metric("Avg Gap", f"{df['Band Gap (eV)'].mean():.2f} eV")
    c4.metric("Unique Structures", df["Crystal System"].nunique())
    
    # Table
    st.subheader("📋 Materials Table")
    st.dataframe(df.sort_values("Energy Above Hull (eV/atom)"), use_container_width=True, height=400)
    # PASTE THIS AFTER st.dataframe(...)
st.subheader("🧊 3D Crystal Structure Viewer")
st.markdown("Select a material to view its atomic structure.")

if "structures" in st.session_state and len(st.session_state.structures) > 0:
    selected = st.selectbox("Select material:", list(st.session_state.structures.keys()))
    struct = st.session_state.structures[selected]
    
    coords = struct.cart_coords
    species = [str(site.specie) for site in struct]
    
    color_map = {
        "H": "#FFFFFF", "He": "#D9FFFF", "Li": "#CC80FF", "Be": "#C2FF00",
        "B": "#FFB5B5", "C": "#909090", "N": "#3050F8", "O": "#FF0D0D",
        "F": "#90E050", "Na": "#AB5CF2", "Mg": "#8AFF00", "Al": "#BFA6A6",
        "Si": "#F0C8A0", "P": "#FF8000", "S": "#FFFF30", "Cl": "#1FF01F",
        "K": "#8F40D4", "Ca": "#3DFF00", "Sc": "#E6E6E6", "Ti": "#BFC2C7",
        "V": "#A6A6AB", "Cr": "#8A99C7", "Mn": "#9C7AC7", "Fe": "#E06633",
        "Co": "#F090A0", "Ni": "#50D050", "Cu": "#C78033", "Zn": "#7D80B0",
        "Ga": "#C28F8F", "Ge": "#668F8F", "As": "#BD80E3", "Se": "#FFA100",
        "Br": "#A62929", "Rb": "#702EB0", "Sr": "#00FF00", "Y": "#94FFFF",
        "Zr": "#94E0E0", "Nb": "#73C2C9", "Mo": "#54B5B5", "Tc": "#3B9E9E",
        "Ru": "#248F8F", "Rh": "#0A7D8C", "Pd": "#006985", "Ag": "#C0C0C0",
        "Cd": "#FFD98F", "In": "#A67573", "Sn": "#668080", "Sb": "#9E63B5",
        "Te": "#D47A00", "I": "#940094", "Xe": "#429EB0", "Cs": "#57178F",
        "Ba": "#00C900", "La": "#70D4FF", "Ce": "#FFFFC7", "Pr": "#D9FFC7",
        "Nd": "#C7FFC7", "Pm": "#A3FFC7", "Sm": "#8FFFC7", "Eu": "#61FFC7",
        "Gd": "#45FFC7", "Tb": "#30FFC7", "Dy": "#1FFFC7", "Ho": "#00FF9C",
        "Er": "#00E675", "Tm": "#00D452", "Yb": "#00BF38", "Lu": "#00AB24",
        "Hf": "#4DC2FF", "Ta": "#4DA6FF", "W": "#2194D6", "Re": "#267DAB",
        "Os": "#266696", "Ir": "#175487", "Pt": "#D0D0E0", "Au": "#FFD123",
        "Hg": "#B8B8D0", "Tl": "#A6544D", "Pb": "#575961", "Bi": "#9E4FB5",
        "Po": "#AB5C00", "At": "#754F45", "Rn": "#428296", "Fr": "#420066",
        "Ra": "#007D00", "Ac": "#70ABFA", "Th": "#00BAFF", "Pa": "#00A1FF",
        "U": "#008FFF", "Np": "#0080FF", "Pu": "#006BFF", "Am": "#545CF2",
        "Cm": "#785CE3", "Bk": "#8A4FE3", "Cf": "#A136D4", "Es": "#B31FD4",
        "Fm": "#B31FBA", "Md": "#B30DA6", "No": "#BD0D87", "Lr": "#C70066"
    }
    colors = [color_map.get(s, "#888888") for s in species]
    sizes = [25 if s in ["H", "He"] else 35 if s in ["C", "N", "O", "F", "Ne"] 
             else 50 if s in ["Na", "Mg", "Al", "Si", "P", "S", "Cl"] else 65 for s in species]
    
    fig_3d = go.Figure(data=[go.Scatter3d(
        x=coords[:, 0], y=coords[:, 1], z=coords[:, 2],
        mode='markers',
        marker=dict(size=sizes, color=colors, opacity=0.95, line=dict(color='black', width=1)),
        text=species,
        hovertemplate='<b>%{text}</b><br>x: %{x:.3f} Å<br>y: %{y:.3f} Å<br>z: %{z:.3f} Å<extra></extra>'
    )])
    
    lattice = struct.lattice
    corners = [[0,0,0], [1,0,0], [1,1,0], [0,1,0], [0,0,1], [1,0,1], [1,1,1], [0,1,1]]
    corner_coords = [lattice.get_cartesian_coords(c) for c in corners]
    edges = [(0,1), (1,2), (2,3), (3,0), (4,5), (5,6), (6,7), (7,4), (0,4), (1,5), (2,6), (3,7)]
    for edge in edges:
        x = [corner_coords[edge[0]][0], corner_coords[edge[1]][0]]
        y = [corner_coords[edge[0]][1], corner_coords[edge[1]][1]]
        z = [corner_coords[edge[0]][2], corner_coords[edge[1]][2]]
        fig_3d.add_trace(go.Scatter3d(x=x, y=y, z=z, mode='lines',
            line=dict(color='gray', width=2), hoverinfo='skip', showlegend=False))
    
    fig_3d.update_layout(
        title=dict(text=f"Crystal Structure: {selected}  ({struct.lattice.a:.3f} × {struct.lattice.b:.3f} × {struct.lattice.c:.3f} Å)", font=dict(size=14)),
        scene=dict(
            xaxis=dict(title="x (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True, zeroline=False),
            yaxis=dict(title="y (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True, zeroline=False),
            zaxis=dict(title="z (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True, zeroline=False),
            aspectmode='data',
            camera=dict(eye=dict(x=1.5, y=1.5, z=1.2))
        ),
        margin=dict(l=0, r=0, b=0, t=40),
        height=550
    )
    st.plotly_chart(fig_3d, use_container_width=True)
    
    col_a, col_b, col_c = st.columns(3)
    col_a.metric("Lattice a", f"{struct.lattice.a:.3f} Å")
    col_b.metric("Lattice b", f"{struct.lattice.b:.3f} Å")
    col_c.metric("Lattice c", f"{struct.lattice.c:.3f} Å")
    else:
    st.info("No structure data available.")
    # Plot 1
    st.subheader("📊 Band Gap vs. Density")
    fig1 = px.scatter(df, x="Density (g/cm³)", y="Band Gap (eV)", color="Crystal System",
                      hover_data=["Formula", "Material ID", "Stable"], size="Volume (Å³)", opacity=0.7)
    st.plotly_chart(fig1, use_container_width=True)
    
    # Plot 2
    st.subheader("📈 Band Gap Distribution")
    fig2 = px.histogram(df, x="Band Gap (eV)", color="Crystal System", nbins=30)
    st.plotly_chart(fig2, use_container_width=True)
    
    # Plot 3
    st.subheader("🎯 Stability Map (Lower = More Stable)")
    fig3 = px.scatter(df, x="Band Gap (eV)", y="Energy Above Hull (eV/atom)",
                      color="Stable", hover_data=["Formula"], log_y=True)
    st.plotly_chart(fig3, use_container_width=True)
    
    # Download
    csv = df.to_csv(index=False)
    st.download_button("Download CSV", csv, "materials_screening.csv", "text/csv")
    
else:
    st.markdown("""
    ### Welcome to the Materials Explorer!
    
    **What this tool does:** It queries the real Materials Project database and lets you filter by properties that matter for real applications.
    
    **How to use it:**
    2. Pick a **preset** (battery materials, solar cells, etc.) or set custom filters
    3. Click **Load Materials**
    
    **Key concepts:**
    - **Band Gap** → 0 = metal, 0.1–3 = semiconductor, >3 = insulator
    - **Energy Above Hull** → 0 = perfectly stable, >0.1 = probably can't be synthesized
    - **Crystal System** → how atoms pack (cubic = metals, hexagonal = ceramics, etc.)
    """)
