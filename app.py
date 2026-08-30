import streamlit as st
import plotly.graph_objects as go
from mp_api.client import MPRester
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer
from pymatgen.core import Element
import periodictable as pt
import random

st.set_page_config(page_title="Materials Explorer", layout="wide")
st.title("🔬 Materials Science Dashboard")
st.markdown("Search or browse materials from the Materials Project database")

# --- API Key ---
api_key = st.secrets.get("MP_API_KEY", None)
if not api_key:
    st.error(" API key not configured. Add MP_API_KEY to Streamlit secrets.")
    st.stop()

# --- POPULAR MATERIALS DATABASE ---
POPULAR_MATERIALS = [
    ("Silicon", "Si"),
    ("Gallium Arsenide", "GaAs"),
    ("Lithium Iron Phosphate", "LiFePO4"),
    ("Molybdenum Disulfide", "MoS2"),
    ("Barium Titanate", "BaTiO3"),
    ("Copper", "Cu"),
    ("Aluminum Oxide", "Al2O3"),
    ("Titanium Dioxide", "TiO2"),
    ("Zinc Oxide", "ZnO"),
    ("Sodium Chloride", "NaCl"),
    ("Diamond", "C"),
    ("Iron", "Fe"),
    ("Gold", "Au"),
    ("Magnesium Oxide", "MgO"),
    ("Cesium Chloride", "CsCl"),
    ("Lithium Cobalt Oxide", "LiCoO2"),
    ("Calcium Carbonate", "CaCO3"),
    ("Quartz", "SiO2"),
    ("Yttrium Barium Copper Oxide", "YBa2Cu3O7"),
    ("Lead", "Pb"),
    ("Graphite", "C"),
    ("Strontium Titanate", "SrTiO3"),
    ("Tungsten", "W"),
    ("Platinum", "Pt"),
    ("Barium", "Ba"),
]

# --- Central Search ---
st.subheader("🔎 Search for a Material")
col1, col2 = st.columns([3, 1])
with col1:
    search_query = st.text_input("Enter chemical formula or material ID (e.g., SiO2, Ba, mp-149)", 
                                  placeholder="e.g., SiO2, LiFePO4, Ba", key="search_input")
with col2:
    search_button = st.button("Search", type="primary", use_container_width=True)

# --- BROWSE POPULAR MATERIALS ---
st.subheader(" Or Browse Popular Materials")

if st.button(" Random Material", use_container_width=True):
    _, random_formula = random.choice(POPULAR_MATERIALS)
    st.session_state.search_query_override = random_formula
    st.rerun()

cols_per_row = 5
for i in range(0, len(POPULAR_MATERIALS), cols_per_row):
    row_cols = st.columns(cols_per_row)
    for j, (name, formula) in enumerate(POPULAR_MATERIALS[i:i+cols_per_row]):
        with row_cols[j]:
            if st.button(f"{name}\n`{formula}`", key=f"pop_{formula}_{i}_{j}", use_container_width=True):
                st.session_state.search_query_override = formula
                st.rerun()

if "search_query_override" in st.session_state:
    search_query = st.session_state.search_query_override
    del st.session_state.search_query_override
    search_button = True

# --- Fetch Results ---
if search_button and search_query and search_query.strip():
    with st.spinner("Searching..."):
        try:
            with MPRester(api_key) as mpr:
                q = search_query.strip()
                
                if q.startswith("mp-"):
                    docs = mpr.materials.summary.search(
                        material_ids=[q],
                        fields=["material_id", "formula_pretty", "band_gap", "density", 
                                "volume", "symmetry", "energy_above_hull", "is_stable",
                                "formation_energy_per_atom", "nsites", "structure", 
                                "elements", "theoretical", "deprecated"]
                    )
                else:
                    docs = mpr.materials.summary.search(
                        formula=q,
                        fields=["material_id", "formula_pretty", "band_gap", "density", 
                                "volume", "symmetry", "energy_above_hull", "is_stable",
                                "formation_energy_per_atom", "nsites", "structure", 
                                "elements", "theoretical", "deprecated"]
                    )
                
                if len(docs) == 0:
                    st.warning("No materials found. Try a different formula or material ID.")
                    st.stop()
                
                st.session_state.search_results = docs
                st.session_state.selected_index = 0
                st.success(f"Found {len(docs)} result(s)")
                
        except Exception as e:
            st.error(f"API Error: {e}")
            st.stop()

# --- Display Selected Material ---
if "search_results" in st.session_state and st.session_state.search_results:
    docs = st.session_state.search_results
    
    if len(docs) > 1:
        options = [f"{d.formula_pretty} ({d.material_id})" for d in docs]
        selected = st.selectbox("Multiple matches found — select one:", options, 
                                 index=st.session_state.selected_index)
        idx = options.index(selected)
        st.session_state.selected_index = idx
    else:
        idx = 0
    
    d = docs[idx]
    
    # --- HEADER ---
    st.divider()
    st.header(d.formula_pretty)
    st.caption(f"Material ID: `{d.material_id}`")
    
    # --- 3D STRUCTURE (Textbook Style) ---
    st.subheader("🧊 Crystal Structure")
    
    if d.structure:
        struct = d.structure
        
        # Convert to conventional cell
        try:
            sga = SpacegroupAnalyzer(struct)
            struct = sga.get_conventional_standard_structure()
        except Exception:
            pass
        
        # For visualization: create 3x3x3 supercell to show textbook-style spheres
        # For large structures, just show conventional cell
        if len(struct) <= 20:
            viz_struct = struct * [3, 3, 3]
            draw_central_cell = True
        else:
            viz_struct = struct
            draw_central_cell = False
        
        coords = viz_struct.cart_coords
        species = [str(site.specie) for site in viz_struct]
        
        # CPK colors
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
        
        # Draw the central cell box (RED, thick)
        if draw_central_cell:
            lattice = struct.lattice
            corners = [
                lattice.get_cartesian_coords([1, 1, 1]),
                lattice.get_cartesian_coords([2, 1, 1]),
                lattice.get_cartesian_coords([2, 2, 1]),
                lattice.get_cartesian_coords([1, 2, 1]),
                lattice.get_cartesian_coords([1, 1, 2]),
                lattice.get_cartesian_coords([2, 1, 2]),
                lattice.get_cartesian_coords([2, 2, 2]),
                lattice.get_cartesian_coords([1, 2, 2]),
            ]
        else:
            lattice = struct.lattice
            corners = [
                lattice.get_cartesian_coords([0, 0, 0]),
                lattice.get_cartesian_coords([1, 0, 0]),
                lattice.get_cartesian_coords([1, 1, 0]),
                lattice.get_cartesian_coords([0, 1, 0]),
                lattice.get_cartesian_coords([0, 0, 1]),
                lattice.get_cartesian_coords([1, 0, 1]),
                lattice.get_cartesian_coords([1, 1, 1]),
                lattice.get_cartesian_coords([0, 1, 1]),
            ]
        
        edges = [(0,1), (1,2), (2,3), (3,0), (4,5), (5,6), (6,7), (7,4), (0,4), (1,5), (2,6), (3,7)]
        for edge in edges:
            x = [corners[edge[0]][0], corners[edge[1]][0]]
            y = [corners[edge[0]][1], corners[edge[1]][1]]
            z = [corners[edge[0]][2], corners[edge[1]][2]]
            fig_3d.add_trace(go.Scatter3d(x=x, y=y, z=z, mode='lines',
                line=dict(color='red', width=3), hoverinfo='skip', showlegend=False))
        
        fig_3d.update_layout(
            scene=dict(
                xaxis=dict(title="x (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True),
                yaxis=dict(title="y (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True),
                zaxis=dict(title="z (Å)", showbackground=True, backgroundcolor="rgb(245,245,245)", showgrid=True),
                aspectmode='data',
                camera=dict(eye=dict(x=1.5, y=1.5, z=1.2))
            ),
            margin=dict(l=0, r=0, b=0, t=10),
            height=500
        )
        st.plotly_chart(fig_3d, use_container_width=True)
        
        # Lattice constants
        lc1, lc2, lc3, lc4, lc5, lc6 = st.columns(6)
        lc1.metric("a", f"{struct.lattice.a:.3f} Å")
        lc2.metric("b", f"{struct.lattice.b:.3f} Å")
        lc3.metric("c", f"{struct.lattice.c:.3f} Å")
        lc4.metric("α", f"{struct.lattice.alpha:.1f}°")
        lc5.metric("β", f"{struct.lattice.beta:.1f}°")
        lc6.metric("γ", f"{struct.lattice.gamma:.1f}°")
    else:
        st.info("No structure data available for this material.")
    
    # --- PROPERTIES GRID ---
    st.subheader(" Properties")
    
    r1c1, r1c2, r1c3, r1c4 = st.columns(4)
    with r1c1:
        gap = d.band_gap if d.band_gap is not None else 0
        st.metric("Band Gap", f"{gap:.3f} eV")
        if gap == 0:
            st.caption("Metal / Conductor")
        elif gap < 1:
            st.caption("Narrow-gap Semiconductor")
        elif gap < 3:
            st.caption("Semiconductor")
        else:
            st.caption("Insulator / Wide-gap")
    with r1c2:
        st.metric("Density", f"{d.density:.3f} g/cm³")
    with r1c3:
        st.metric("Volume", f"{d.volume:.2f} Å³")
    with r1c4:
        # Use len(struct) for actual conventional cell atom count
        atom_count = len(struct) if d.structure else d.nsites
        st.metric("Atoms / Cell", atom_count)
    
    st.markdown("**Thermodynamic Properties**")
    r2c1, r2c2 = st.columns(2)
    with r2c1:
        hull = d.energy_above_hull if d.energy_above_hull is not None else 0
        st.metric("Energy Above Hull", f"{hull:.4f} eV/atom")
    with r2c2:
        form = d.formation_energy_per_atom if d.formation_energy_per_atom is not None else 0
        st.metric("Formation Energy", f"{form:.3f} eV/atom")
    
    st.markdown("**Crystal Structure**")
    r3c1, r3c2, r3c3 = st.columns(3)
    with r3c1:
        cs = str(d.symmetry.crystal_system) if d.symmetry else "Unknown"
        st.metric("Crystal System", cs)
    with r3c2:
        sg = d.symmetry.symbol if d.symmetry else "Unknown"
        st.metric("Space Group", sg)
    with r3c3:
        sg_num = d.symmetry.number if d.symmetry else "—"
        st.metric("Space Group #", sg_num)
    
    # --- COMPOSITION & ELEMENTS ---
    st.subheader(" Composition")
    
    if d.elements:
        elems = sorted([str(e) for e in d.elements])
        avg_mass = sum(Element(e).atomic_mass for e in elems) / len(elems)
        
        r4c1, r4c2 = st.columns(2)
        with r4c1:
            st.markdown(f"**Elements:** {', '.join(elems)}")
        with r4c2:
            st.metric("Avg. Atomic Mass", f"{avg_mass:.2f} amu")
        
        # SINGLE ELEMENT: prominent isotope display
        if len(elems) == 1:
            elem = elems[0]
            st.subheader(f" Isotopes of {elem}")
            
            try:
                pt_elem = getattr(pt, elem, None)
                if pt_elem:
                    isos = [(iso.mass, iso.abundance) for iso in pt_elem if iso.abundance and iso.abundance > 0]
                    isos.sort(key=lambda x: x[1], reverse=True)
                    
                    if isos:
                        iso_data = []
                        for mass, abund in isos:
                            iso_data.append({
                                "Isotope": f"{elem}-{int(mass)}",
                                "Mass (amu)": round(mass, 4),
                                "Natural Abundance (%)": round(abund, 2)
                            })
                        
                        import pandas as pd
                        iso_df = pd.DataFrame(iso_data)
                        st.dataframe(iso_df, use_container_width=True, hide_index=True)
                        
                        most_abundant = iso_data[0]
                        st.info(f"Most abundant natural isotope: **{most_abundant['Isotope']}** ({most_abundant['Natural Abundance (%)']}%)")
                    else:
                        st.info("No stable isotopes known for this element.")
                else:
                    st.info("Isotope data not available.")
            except Exception:
                st.info("Isotope data not available.")
            
            # Single element detail card (large)
            el = Element(elem)
            st.subheader(f" Properties of {elem}")
            
            ec1, ec2, ec3, ec4 = st.columns(4)
            with ec1:
                st.metric("Atomic Number", el.Z)
                st.metric("Atomic Mass", f"{el.atomic_mass:.3f} amu")
            with ec2:
                group = el.group if hasattr(el, 'group') else "—"
                period = el.row if hasattr(el, 'row') else "—"
                st.metric("Group", group)
                st.metric("Period", period)
            with ec3:
                en = getattr(el, 'X', None)
                st.metric("Electronegativity", f"{en:.2f}" if en else "—")
                ox = el.common_oxidation_states if hasattr(el, 'common_oxidation_states') else []
                ox_str = ", ".join([f"{o:+.0f}" if o != 0 else "0" for o in sorted(ox)]) if ox else "—"
                st.metric("Oxidation States", ox_str)
            with ec4:
                r_cov = el.atomic_radius if hasattr(el, 'atomic_radius') else None
                r_vdw = el.van_der_waals_radius if hasattr(el, 'van_der_waals_radius') else None
                radius = r_cov if r_cov else (r_vdw if r_vdw else None)
                st.metric("Atomic Radius", f"{radius} pm" if radius else "—")
                es = el.electronic_structure if hasattr(el, 'electronic_structure') else None
                st.metric("Electron Config", es if es else "—")
        
        # COMPOUND: element cards with small isotope captions
        else:
            elem_cols = st.columns(len(elems))
            for i, elem in enumerate(elems):
                el = Element(elem)
                with elem_cols[i]:
                    st.markdown(f"**{elem}** — *{el.long_name}*")
                    
                    st.caption(f" Z = {el.Z}")
                    st.caption(f" Mass: {el.atomic_mass:.3f} amu")
                    
                    group = el.group if hasattr(el, 'group') else "—"
                    period = el.row if hasattr(el, 'row') else "—"
                    st.caption(f" Group {group}, Period {period}")
                    
                    en = getattr(el, 'X', None)
                    if en:
                        st.caption(f"⚡ EN = {en:.2f}")
                    else:
                        st.caption("⚡ EN = —")
                    
                    ox = el.common_oxidation_states if hasattr(el, 'common_oxidation_states') else []
                    if ox:
                        ox_str = ", ".join([f"{o:+.0f}" if o != 0 else "0" for o in sorted(ox)])
                        st.caption(f"🔋 Ox: {ox_str}")
                    else:
                        st.caption("🔋 Ox: —")
                    
                    es = el.electronic_structure if hasattr(el, 'electronic_structure') else None
                    if es:
                        st.caption(f" {es}")
                    else:
                        st.caption(" —")
                    
                    r_cov = el.atomic_radius if hasattr(el, 'atomic_radius') else None
                    r_vdw = el.van_der_waals_radius if hasattr(el, 'van_der_waals_radius') else None
                    if r_cov:
                        st.caption(f" Radius: {r_cov} pm")
                    elif r_vdw:
                        st.caption(f" VdW: {r_vdw} pm")
                    else:
                        st.caption(" Radius: —")
                    
                    # Small isotope captions for compounds
                    try:
                        pt_elem = getattr(pt, elem, None)
                        if pt_elem:
                            isos = [(iso.mass, iso.abundance) for iso in pt_elem if iso.abundance and iso.abundance > 0]
                            isos.sort(key=lambda x: x[1], reverse=True)
                            if isos:
                                iso_lines = [f"{elem}-{int(mass)} ({abund:.1f}%)" for mass, abund in isos[:3]]
                                st.caption(" " + ", ".join(iso_lines))
                            else:
                                st.caption(" No stable isotopes")
                        else:
                            st.caption("—")
                    except Exception:
                        st.caption(" —")
    
    

else:
    st.markdown("""
    ###  Welcome!
    
    Enter a chemical formula (e.g., `SiO2`, `Ba`, `LiFePO4`) or a Materials Project ID (e.g., `mp-149`) 
    in the search box above, click **Search**, or pick a material from the browse grid below.
    """)
