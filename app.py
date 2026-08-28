import streamlit as st
import plotly.express as px
from mp_api.client import MPRester
import pandas as pd

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
                               "density", "volume", "symmetry", "energy_above_hull",
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
            
            data = []
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
