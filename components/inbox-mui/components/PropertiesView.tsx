"use client";
import React, { useMemo, useState } from 'react';
import {
  Box,
  Card,
  Stack,
  Typography,
  Chip,
  TextField,
  InputAdornment,
  Button,
  ButtonGroup,
  ListItemButton,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/SwapVert';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import ViewListIcon from '@mui/icons-material/ViewListOutlined';
import ViewModuleIcon from '@mui/icons-material/ViewModuleOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { type Property } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { PropertyModal } from './PropertyModal';

const emptyProperty: Property = {
  id: '', address: '', city: '', price: 'Blank', priceNum: '', beds: '', baths: '',
  sqft: '', year: '', type: '', neighborhood: '', zip: '', broker: '',
};

type ViewMode = 'sheet' | 'grid';

export function PropertiesView() {
  const { properties, propertyHealth } = useInboxModel();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(properties[0]?.id ?? '');
  const [modalProperty, setModalProperty] = useState<Property | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('sheet');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) =>
    [p.address, p.city, p.zip, p.price, p.beds, p.type, p.neighborhood].
    join(' ').
    toLowerCase().
    includes(q)
    );
  }, [query]);
  const selected: Property = properties.find((p) => p.id === selectedId) ?? properties[0] ?? emptyProperty;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6">Properties</Typography>
        <ButtonGroup size="small" aria-label="Properties view mode">
          <Button
            variant={viewMode === 'sheet' ? 'contained' : 'outlined'}
            disableElevation
            startIcon={<ViewListIcon fontSize="small" />}
            onClick={() => setViewMode('sheet')}
          >
            Sheet
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'contained' : 'outlined'}
            disableElevation
            startIcon={<ViewModuleIcon fontSize="small" />}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </Button>
        </ButtonGroup>
      </Stack>

      {viewMode === 'grid' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <PropertyHealthStrip propertyHealth={propertyHealth} />
          <PropertiesGrid
            properties={filtered}
            query={query}
            onQueryChange={setQuery}
            onOpenModal={(p) => setModalProperty(p)}
          />
        </Box>
      ) : (
      <Box
        sx={{
          display: 'flex',
          flexDirection: {
            xs: 'column',
            lg: 'row'
          },
          gap: 2,
          flex: 1,
          minHeight: 0,
          overflowY: {
            xs: 'auto',
            lg: 'visible'
          }
        }}>

        {/* Data health */}
        <Card
          sx={{
            width: {
              xs: '100%',
              lg: 230
            },
            flexShrink: 0,
            p: 2,
            alignSelf: {
              xs: 'stretch',
              lg: 'flex-start'
            }
          }}>

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            sx={{
              mb: 1
            }}>

            <Typography variant="subtitle2">Property Data Health</Typography>
          </Stack>
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={`${propertyHealth.clean} · ${propertyHealth.rows} rows`}
            sx={{
              mb: 1.5
            }} />

          <Stack direction="row" alignItems="baseline" spacing={0.5}>
            <Typography
              variant="h3"
              sx={{
                fontWeight: 800
              }}>

              {propertyHealth.score}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              of {propertyHealth.total}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              mt: 2
            }}>

            <Card
              variant="outlined"
              sx={{
                p: 1.25,
                flex: 1
              }}>

              <Typography variant="caption" color="text.secondary">
                MISSING CORE
              </Typography>
              <Typography variant="h6">{propertyHealth.missingCore}</Typography>
            </Card>
            <Card
              variant="outlined"
              sx={{
                p: 1.25,
                flex: 1
              }}>

              <Typography variant="caption" color="text.secondary">
                DUPLICATE GROUPS
              </Typography>
              <Typography variant="h6">
                {propertyHealth.duplicateGroups}
              </Typography>
            </Card>
          </Stack>
        </Card>

        {/* Property sheet */}
        <Card
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: {
              xs: 420,
              lg: 0
            }
          }}>

          <Box
            sx={{
              p: 1.75,
              borderBottom: '1px solid',
              borderColor: 'divider'
            }}>

            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 1.5
              }}>

              <Typography variant="subtitle1">Property Sheet</Typography>
              <Chip
                size="small"
                variant="outlined"
                label={`${propertyHealth.rows} rows`} />

            </Stack>
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap>

              <TextField
                sx={{
                  flex: 1,
                  minWidth: 180
                }}
                size="small"
                placeholder="Search address, city, zip, price, beds, features..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                InputProps={{
                  startAdornment:
                  <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>

                }}
                aria-label="Search properties" />

              <Chip
                size="small"
                variant="outlined"
                label={`${filtered.length} shown`}
                sx={{
                  flexShrink: 0
                }} />

              <Button
                size="small"
                variant="outlined"
                startIcon={<SortIcon />}
                sx={{
                  flexShrink: 0
                }}>

                Sheet order
              </Button>
            </Stack>
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowX: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}>

            {/* Column header */}
            <Box
              sx={{
                display: 'flex',
                px: 2,
                py: 1,
                minWidth: 620,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover'
              }}>

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  flex: 1
                }}>

                ADDRESS
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 110
                }}>

                PRICE
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 50
                }}>

                BEDS
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 56
                }}>

                BATHS
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 56
                }}>

                PHOTO
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 56
                }}>

                SQFT
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontWeight: 700,
                  width: 48
                }}>

                YEAR
              </Typography>
            </Box>

            <Box
              sx={{
                overflowY: 'auto',
                flex: 1,
                minWidth: 620
              }}>

              {filtered.map((p) =>
              <PropertyRow
                key={p.id}
                property={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)} />

              )}
            </Box>
          </Box>
        </Card>

        {/* Selected detail */}
        <PropertyDetail property={selected} onOpenModal={() => setModalProperty(selected)} />
      </Box>
      )}

      <PropertyModal
        property={modalProperty}
        open={modalProperty !== null}
        onClose={() => setModalProperty(null)}
      />
    </Box>
    );

}

function PropertyHealthStrip({ propertyHealth }: { propertyHealth: ReturnType<typeof useInboxModel>['propertyHealth'] }) {
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
      <Chip
        size="small"
        color="success"
        variant="outlined"
        label={`${propertyHealth.clean} · ${propertyHealth.rows} rows`}
      />
      <Chip size="small" variant="outlined" label={`Score ${propertyHealth.score} of ${propertyHealth.total}`} />
      <Chip size="small" variant="outlined" label={`${propertyHealth.missingCore} missing core`} />
      <Chip size="small" variant="outlined" label={`${propertyHealth.duplicateGroups} duplicate groups`} />
    </Stack>
  );
}

function PropertiesGrid({
  properties,
  query,
  onQueryChange,
  onOpenModal,
}: {
  properties: Property[];
  query: string;
  onQueryChange: (v: string) => void;
  onOpenModal: (p: Property) => void;
}) {
  return (
    <Box>
      <TextField
        sx={{ mb: 2, maxWidth: 420, width: '100%' }}
        size="small"
        placeholder="Search address, city, zip, price, beds, features..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
        aria-label="Search properties"
      />
      {properties.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            py: 6,
            color: 'text.secondary',
          }}
        >
          <Typography variant="body2">No properties match this search.</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 2.25,
          }}
        >
          {properties.map((p) => (
            <PropertyGridCard key={p.id} property={p} onOpenModal={() => onOpenModal(p)} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function PropertyGridCard({ property, onOpenModal }: { property: Property; onOpenModal: () => void }) {
  const theme = useTheme();
  const iris = theme.iris;
  const isDark = theme.palette.mode === 'dark';
  const elev = isDark
    ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.4)'
    : '0 1px 1px rgba(15,23,42,0.04), 0 8px 18px rgba(15,23,42,0.08), 0 24px 60px rgba(15,23,42,0.06)';
  const elevHover = isDark
    ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(196,154,82,0.18), 0 22px 70px rgba(0,0,0,0.5)'
    : '0 2px 3px rgba(15,23,42,0.05), 0 14px 28px rgba(15,23,42,0.10), 0 34px 80px rgba(15,23,42,0.08)';
  const cardHi = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.9)';
  const isBlank = (v?: string) => !v || v === 'Blank';

  const details = [
    !isBlank(property.beds) && `${property.beds} bd`,
    !isBlank(property.baths) && `${property.baths} ba`,
    !isBlank(property.sqft) && `${property.sqft} sf`,
    !isBlank(property.type) && property.type,
  ].filter(Boolean).join(' · ');

  return (
    <Box
      sx={{
        borderRadius: 4.5,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: iris.cardBorder,
        bgcolor: iris.card,
        boxShadow: `${cardHi}, ${elev}`,
        transition: 'transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: `${cardHi}, ${elevHover}` },
      }}
    >
      {/* Hero */}
      <Box
        onClick={onOpenModal}
        sx={{ position: 'relative', height: 158, bgcolor: iris.surface2, cursor: 'pointer' }}
      >
        {property.photo ? (
          <>
            <Box
              component="img"
              src={property.photo}
              alt={property.address}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.34)' }} />
          </>
        ) : (
          <Box
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: iris.textSubtle,
            }}
          >
            <ImageNotSupportedIcon aria-hidden />
          </Box>
        )}
        {!isBlank(property.status) && (
          <Box
            component="span"
            sx={{
              position: 'absolute', top: 10, left: 10, px: 1.15, py: 0.35,
              fontSize: 11, fontWeight: 500, borderRadius: 999, bgcolor: iris.success, color: '#fff',
            }}
          >
            {property.status}
          </Box>
        )}
        {property.photo && (
          <Box
            component="span"
            sx={{
              position: 'absolute', bottom: 12, left: 12, color: '#fff',
              fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em',
              textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }}
          >
            {property.price}
          </Box>
        )}
      </Box>

      {/* Detail */}
      <Box sx={{ p: 1.9 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{property.address}</Typography>
        <Typography variant="caption" sx={{ color: iris.textSubtle, display: 'block', mt: 0.25 }}>
          {[property.neighborhood, property.city].filter((v) => !isBlank(v)).join(' · ')}
        </Typography>
        {details && (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--font-mono)', color: 'text.secondary', mt: 1.25 }}
          >
            {details}
          </Typography>
        )}
        <Stack direction="row" spacing={0.75} sx={{ mt: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<SendOutlinedIcon sx={{ fontSize: 15 }} />}
            sx={{ flex: 1, fontSize: 12 }}
          >
            Send details
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<EventAvailableIcon sx={{ fontSize: 15 }} />}
            sx={{ flex: 1, fontSize: 12 }}
          >
            Book showing
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}

function PropertyRow({
  property,
  selected,
  onSelect




}: {property: Property;selected: boolean;onSelect: () => void;}) {
  return (
    <ListItemButton
      selected={selected}
      onClick={onSelect}
      sx={{
        alignItems: 'flex-start',
        px: 2,
        py: 1.25,
        borderLeft: '3px solid',
        borderColor: selected ? 'primary.main' : 'transparent',
        borderBottom: '1px solid',
        borderBottomColor: 'divider'
      }}>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          pr: 1
        }}>

        <Typography
          variant="body2"
          sx={{
            fontWeight: 600
          }}>

          {property.address}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {[
          property.city,
          property.price,
          `${property.beds} bd / ${property.baths} bth`,
          `${property.sqft} sqft`,
          property.type,
          property.status].

          filter(Boolean).
          join(' | ')}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{
          width: 110,
          flexShrink: 0
        }}>

        {property.price}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          width: 50,
          flexShrink: 0
        }}>

        {property.beds}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          width: 56,
          flexShrink: 0
        }}>

        {property.baths}
      </Typography>
      <Box
        sx={{
          width: 56,
          flexShrink: 0
        }}>

        {property.photo ?
        <Box
          component="img"
          src={property.photo}
          alt={property.address}
          sx={{
            width: 40,
            height: 30,
            objectFit: 'cover',
            borderRadius: 1
          }} /> :


        <Box
          sx={{
            width: 40,
            height: 30,
            borderRadius: 1,
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary'
          }}>

            <ImageNotSupportedIcon
            sx={{
              fontSize: 14
            }} />

          </Box>
        }
      </Box>
      <Typography
        variant="body2"
        sx={{
          width: 56,
          flexShrink: 0
        }}>

        {property.sqft}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          width: 48,
          flexShrink: 0
        }}>

        {property.year}
      </Typography>
    </ListItemButton>);

}
function PropertyDetail({ property, onOpenModal }: {property: Property; onOpenModal: () => void;}) {
  const theme = useTheme();
  const iris = theme.iris;
  const previewFeatures = [
    property.neighborhood && property.neighborhood !== 'Blank' ? property.neighborhood : '',
    property.type && property.type !== 'Blank' ? property.type : '',
    property.beds && property.baths ? `${property.beds} bd / ${property.baths} ba` : '',
    property.sqft && property.sqft !== 'Blank' ? `${property.sqft} sqft` : '',
  ].filter(Boolean).slice(0, 4);
  const description =
  property.broker && property.broker !== 'Blank' ?
  property.broker :
  `${property.beds || '0'} bedroom ${property.type || 'property'} in ${property.city.split(' · ')[0] || 'Austin'} with ${property.sqft || 'unknown'} sqft.`;
  return (
    <Card
      sx={{
        width: {
          xs: '100%',
          lg: 340
        },
        flexShrink: 0,
        overflowY: 'auto',
        alignSelf: {
          xs: 'stretch',
          lg: 'flex-start'
        },
        maxHeight: {
          xs: 'none',
          lg: '100%'
        }
      }}>

      <Box
        sx={{
          position: 'relative'
        }}>

        {property.photo ?
        <Box
          component="img"
          src={property.photo}
          alt={property.address}
          onClick={onOpenModal}
          sx={{
            width: '100%',
            height: 180,
            objectFit: 'cover',
            cursor: 'pointer',
            '&:hover': { opacity: 0.9 },
            transition: 'opacity .2s',
          }} /> :


        <Box
          sx={{
            width: '100%',
            height: 180,
            bgcolor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary'
          }}>

            <ImageNotSupportedIcon />
          </Box>
        }
        <Button
          size="small"
          variant="contained"
          startIcon={<SendOutlinedIcon />}
          onClick={onOpenModal}
          sx={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            bgcolor: 'rgba(0,0,0,0.7)',
            '&:hover': {
              bgcolor: 'rgba(0,0,0,0.85)'
            }
          }}>

          View details
        </Button>
      </Box>

      <Box
        sx={{
          p: 2
        }}>

        <Typography variant="overline" color="text.secondary">
          Selected property
        </Typography>
        <Typography
          variant="h6"
          sx={{
            mb: 1.5
          }}>

          {property.address} · {property.city.split(' · ')[0]}, TX,{' '}
          {property.zip}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1,
            mb: 2
          }}>

          <DetailCell label="PRICE" value={property.priceNum} />
          <DetailCell
            label="BEDS / BATHS"
            value={`${property.beds} bd / ${property.baths} bth`} />

          <DetailCell label="SQFT" value={property.sqft} />
          <DetailCell label="YEAR BUILT" value={property.year} />
          <DetailCell label="TYPE" value={property.type} />
          <DetailCell label="NEIGHBORHOOD" value={property.neighborhood} />
          <DetailCell label="DAYS ON MARKET" value="Blank" muted />
          <DetailCell label="AGENT" value="Blank" muted />
        </Box>

        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            pt: 1.5
          }}>
          <Typography variant="overline" color="text.secondary">
            Description
          </Typography>
          <Typography
            variant="body2"
            sx={{
              mb: 1.5,
              color: 'text.primary',
              lineHeight: 1.45
            }}>

            {description}
          </Typography>

          <Typography variant="overline" color="text.secondary">
            Features
          </Typography>
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            sx={{
              mb: 1.5
            }}>

            {previewFeatures.map((feature) =>
            <Chip
              key={feature}
              label={feature}
              size="small"
              sx={{
                height: 22,
                bgcolor: iris.accentSoft,
                color: 'text.primary',
                border: '1px solid',
                borderColor: iris.accentSoft,
                '& .MuiChip-label': {
                  px: 0.75,
                  fontSize: 11,
                  fontWeight: 700
                }
              }} />
            )}
          </Stack>
        </Box>

        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            pt: 1.25
          }}>
          <CheckCircleIcon
            fontSize="small"
            sx={{
              color: 'success.main'
            }} />

          <Typography
            variant="body2"
            color="success.main"
            sx={{
              fontWeight: 600
            }}>

            Core data complete
          </Typography>
        </Stack>
      </Box>
    </Card>);

}
function DetailCell({
  label,
  value,
  muted




}: {label: string;value: string;muted?: boolean;}) {
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: 'divider'
      }}>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 700,
          fontSize: 10
        }}>

        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          color: muted ? 'text.secondary' : 'text.primary'
        }}>

        {value}
      </Typography>
    </Box>);

}
