// Ожидаемое поведение: лента из восьми светодиодов WS2812 на выводе 76 показывает восемь цветов:
// красный, оранжевый, жёлтый, зелёный, голубой, синий, фиолетовый, пурпурный. Каждые 0,1 с цвета
// сдвигаются на один светодиод: светодиод i показывает цвет с номером (i + фаза) mod 8.
// Длительности при такте 27 МГц: ноль — единица 10 тактов (370 нс), единица — 20 тактов (741 нс),
// период бита 34 такта (1259 нс), пауза между кадрами 300 мкс. Порядок байтов — GRB.
// Проверочное число: в момент 0,25 с фаза равна 2, светодиод 0 жёлтый (ffff00),
// дальше 00ff00, 00ffff, 0000ff, 8000ff, ff00ff, ff0000, ff8000.
module top (
    input  wire clk,
    output wire din
);
    localparam integer T0H    = 10;
    localparam integer T1H    = 20;
    localparam integer TBIT   = 34;
    localparam integer TRESET = 8100;
    localparam integer PHASE  = 2_700_000;

    reg [21:0] phase_cnt = 0;
    reg [2:0]  phase     = 0;

    always @(posedge clk) begin
        if (phase_cnt == PHASE - 1) begin
            phase_cnt <= 0;
            phase     <= phase + 1'b1;
        end else begin
            phase_cnt <= phase_cnt + 1'b1;
        end
    end

    // Цвет по номеру в порядке передачи: зелёный, красный, синий.
    function [23:0] grb(input [2:0] n);
        case (n)
            3'd0: grb = 24'h00_ff_00;  // красный
            3'd1: grb = 24'h80_ff_00;  // оранжевый
            3'd2: grb = 24'hff_ff_00;  // жёлтый
            3'd3: grb = 24'hff_00_00;  // зелёный
            3'd4: grb = 24'hff_00_ff;  // голубой
            3'd5: grb = 24'h00_00_ff;  // синий
            3'd6: grb = 24'h00_80_ff;  // фиолетовый
            default: grb = 24'h00_ff_ff;  // пурпурный
        endcase
    endfunction

    reg        sending     = 0;
    reg [12:0] tcnt        = 0;
    reg [2:0]  led_idx     = 0;
    reg [4:0]  bit_idx     = 0;
    reg [2:0]  frame_phase = 0;  // фаза не меняется внутри кадра
    reg        out         = 0;

    wire [23:0] color   = grb(led_idx + frame_phase);
    wire        cur_bit = color[5'd23 - bit_idx];

    always @(posedge clk) begin
        if (!sending) begin
            out <= 1'b0;
            if (tcnt == TRESET - 1) begin
                sending     <= 1'b1;
                tcnt        <= 0;
                led_idx     <= 0;
                bit_idx     <= 0;
                frame_phase <= phase;
            end else begin
                tcnt <= tcnt + 1'b1;
            end
        end else begin
            out <= tcnt < (cur_bit ? T1H : T0H);
            if (tcnt == TBIT - 1) begin
                tcnt <= 0;
                if (bit_idx == 23) begin
                    bit_idx <= 0;
                    if (led_idx == 7) sending <= 1'b0;
                    else led_idx <= led_idx + 1'b1;
                end else begin
                    bit_idx <= bit_idx + 1'b1;
                end
            end else begin
                tcnt <= tcnt + 1'b1;
            end
        end
    end

    assign din = out;
endmodule
