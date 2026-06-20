import React from 'react';
import { Box, Stack, Typography, Button } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
interface ReaderFooterProps {
  actionLabel?: string;
}
export function ReaderFooter({ actionLabel = 'Take over' }: ReaderFooterProps) {
  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        p: 1.5,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        bgcolor: 'background.paper'
      }}>
      
      <Stack direction="row" spacing={0.75} alignItems="center">
        <CircleIcon
          sx={{
            fontSize: 10,
            color: 'success.main'
          }} />
        
        <Typography variant="body2" color="text.secondary">
          AI active
        </Typography>
      </Stack>
      <Button variant="outlined" size="small">
        {actionLabel}
      </Button>
    </Box>);

}